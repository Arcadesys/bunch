import "dotenv/config";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { normalizePgConnectionString } from "@/db/client";

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required for migrations.");

async function main() {
  const pool = new Pool({ connectionString: normalizePgConnectionString(connectionString), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext('system-arcades-me:migrations'))");
    await client.query(`create table if not exists drizzle_migration (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);

    const directory = join(process.cwd(), "drizzle");
    const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const applied = await client.query("select 1 from drizzle_migration where name = $1", [file]);
      if (applied.rowCount) continue;
      await client.query(await readFile(join(directory, file), "utf8"));
      await client.query("insert into drizzle_migration (name) values ($1)", [file]);
      console.log(`Applied ${file}`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
