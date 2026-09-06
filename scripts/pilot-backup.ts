/** Encrypted full backup and isolated restore rehearsal. No live restore command. */
import "dotenv/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { Pool } from "pg";
import { get } from "@vercel/blob";
const exec = promisify(execFile);
const command = process.argv[2];
const secret = process.env.PILOT_BACKUP_KEY;
if (!secret || !/^[0-9a-f]{64}$/i.test(secret))
  throw new Error(
    "PILOT_BACKUP_KEY must be a securely stored 32-byte hexadecimal key.",
  );
const key = Buffer.from(secret, "hex");
const connection = process.env.DATABASE_URL_UNPOOLED;
if (!connection) throw new Error("DATABASE_URL_UNPOOLED is required.");
async function main() {
  const stage = await mkdtemp(join(tmpdir(), "diddy-backup-"));
  const pool = new Pool({ connectionString: connection, max: 2 });
  function pgEnv(value: string) {
    const url = new URL(value);
    return {
      ...process.env,
      PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username) || process.env.USER,
      PGPASSWORD: decodeURIComponent(url.password),
      PGSSLMODE:
        url.searchParams.get("sslmode") ??
        (url.hostname === "127.0.0.1" ? "disable" : "verify-full"),
    };
  }
  const env = pgEnv(connection);
  async function hash(file: string) {
    const h = createHash("sha256");
    for await (const part of createReadStream(file)) h.update(part);
    return h.digest("hex");
  }
  try {
    if (command === "prune") {
      if (!process.env.PILOT_BACKUP_DIR)
        throw new Error("PILOT_BACKUP_DIR is required.");
      const destination = resolve(process.env.PILOT_BACKUP_DIR);
      for (const file of await readdir(destination))
        if (
          /^diddy-\d+\.diddy-backup$/.test(file) &&
          Date.now() - (await stat(join(destination, file))).mtimeMs >=
            7 * 86400000
        )
          await rm(join(destination, file));
      console.log("Expired encrypted backups pruned.");
    } else if (command === "create") {
      if (!process.env.PILOT_BACKUP_DIR)
        throw new Error(
          "Set PILOT_BACKUP_DIR to the existing protected offsite destination.",
        );
      const destination = resolve(process.env.PILOT_BACKUP_DIR);
      if (destination.startsWith(process.cwd() + "/"))
        throw new Error("Backups must be outside the source checkout.");
      await mkdir(destination, { recursive: true, mode: 0o700 });
      await mkdir(join(stage, "media"), { mode: 0o700 });
      const c = await pool.connect();
      const manifest: {
        version: number;
        createdAt: string;
        databaseSha256?: string;
        media: Array<{ file: string; sha256: string; storageKey: string }>;
      } = { version: 1, createdAt: new Date().toISOString(), media: [] };
      try {
        await c.query("begin isolation level repeatable read read only");
        const snapshot = (await c.query("select pg_export_snapshot() as id"))
          .rows[0].id;
        await exec(
          "pg_dump",
          [
            "--format=custom",
            "--exclude-table-data=*.conversation_summary",
            "--no-owner",
            `--snapshot=${snapshot}`,
            `--file=${join(stage, "database.dump")}`,
          ],
          { env },
        );
        const images = (
          await c.query(
            "select storage_key from private_image union select storage_key from pilot_upload where state='STORED'",
          )
        ).rows;
        for (const image of images) {
          const file = createHash("sha256")
            .update(image.storage_key)
            .digest("hex");
          const blob = await get(image.storage_key, { access: "private" });
          if (!blob || blob.statusCode !== 200 || !blob.stream)
            throw new Error(
              "A referenced private image was unavailable; backup rejected.",
            );
          await pipeline(
            Readable.fromWeb(blob.stream as never),
            createWriteStream(join(stage, "media", file), { mode: 0o600 }),
          );
          manifest.media.push({
            file,
            sha256: await hash(join(stage, "media", file)),
            storageKey: image.storage_key,
          });
        }
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      } finally {
        c.release();
      }
      manifest.databaseSha256 = await hash(join(stage, "database.dump"));
      await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest), {
        mode: 0o600,
      });
      await exec("tar", [
        "-cf",
        join(stage, "payload.tar"),
        "-C",
        stage,
        "database.dump",
        "manifest.json",
        "media",
      ]);
      const nonce = randomBytes(12),
        cipher = createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = join(stage, "payload.enc");
      await pipeline(
        createReadStream(join(stage, "payload.tar")),
        cipher,
        createWriteStream(encrypted, { mode: 0o600 }),
      );
      const name = `diddy-${Date.now()}.diddy-backup`;
      const output = createWriteStream(join(destination, name), {
        mode: 0o600,
      });
      output.write(
        Buffer.concat([Buffer.from("DIDDY01"), nonce, cipher.getAuthTag()]),
      );
      await pipeline(createReadStream(encrypted), output);
      // Prune only this tool's artifacts, never unrelated backups.
      for (const file of await readdir(destination))
        if (
          /^diddy-\d+\.diddy-backup$/.test(file) &&
          Date.now() - (await stat(join(destination, file))).mtimeMs >=
            7 * 86400000
        )
          await rm(join(destination, file));
      console.log(
        JSON.stringify({
          backup: join(destination, name),
          mediaCount: manifest.media.length,
          encrypted: true,
        }),
      );
    } else if (command === "verify") {
      const file = resolve(process.argv[3] ?? "");
      const restore = process.env.PILOT_RESTORE_DATABASE_URL;
      if (
        !restore ||
        !/^pilot_restore_[a-z0-9_]+$/.test(new URL(restore).pathname.slice(1))
      )
        throw new Error(
          "PILOT_RESTORE_DATABASE_URL must name an empty pilot_restore_* database.",
        );
      const target = new Pool({ connectionString: restore });
      try {
        const tables = await target.query(
          "select 1 from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
        );
        if (tables.rowCount) throw new Error("Restore target must be empty.");
        const handle = await open(file, "r");
        const header = Buffer.alloc(35);
        try {
          await handle.read(header, 0, 35, 0);
        } finally {
          await handle.close();
        }
        if (header.subarray(0, 7).toString() !== "DIDDY01")
          throw new Error("Invalid backup header.");
        const cipher = createDecipheriv(
          "aes-256-gcm",
          key,
          header.subarray(7, 19),
        );
        cipher.setAuthTag(header.subarray(19, 35));
        await pipeline(
          createReadStream(file, { start: 35 }),
          cipher,
          createWriteStream(join(stage, "payload.tar"), { mode: 0o600 }),
        );
        // Archive is authenticated before extraction, and was created by this tool.
        await exec("tar", ["-xf", join(stage, "payload.tar"), "-C", stage]);
        const manifest = JSON.parse(
          await readFile(join(stage, "manifest.json"), "utf8"),
        );
        if (
          manifest.databaseSha256 !== (await hash(join(stage, "database.dump")))
        )
          throw new Error("Database checksum mismatch.");
        for (const image of manifest.media) {
          if (
            !/^[0-9a-f]{64}$/.test(image.file) ||
            image.sha256 !== (await hash(join(stage, "media", image.file)))
          )
            throw new Error("Image checksum mismatch.");
        }
        await exec(
          "pg_restore",
          [
            "--no-owner",
            "--no-privileges",
            "--exit-on-error",
            "--dbname",
            new URL(restore).pathname.slice(1),
            join(stage, "database.dump"),
          ],
          { env: pgEnv(restore) },
        );
        await target.query(
          "update pilot_policy set invitations_open=false,friends_enabled=false,uploads_enabled=false,gate_enabled=true where id",
        );
        // Replay current deletion/revocation tombstones before any restored data may be served.
        const denied = (
          await pool.query(
            "select owner_id,state from pilot_account where state<>'ACTIVE'",
          )
        ).rows;
        for (const row of denied)
          await target.query(
            "update pilot_account set state=$2 where owner_id=$1",
            [row.owner_id, row.state],
          );
        const exposed = await target.query(
          "select count(*)::int as n from pilot_policy where friends_enabled or invitations_open",
        );
        if (exposed.rows[0].n !== 0)
          throw new Error("Restored pilot must stay closed.");
        console.log(
          JSON.stringify({
            databaseRestored: true,
            mediaChecksumsVerified: manifest.media.length,
            accessClosed: true,
            tombstonesReplayed: denied.length,
            liveRestorePerformed: false,
          }),
        );
      } finally {
        await target.end();
      }
    } else
      throw new Error(
        "Usage: pilot-backup.ts create | prune | verify ENCRYPTED_FILE",
      );
  } finally {
    await pool.end();
    await rm(stage, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error(
    "Backup operation failed. No recovery readiness is certified. Check credentials, destination, media availability, and the empty restore target.",
  );
  process.exitCode = 1;
});
