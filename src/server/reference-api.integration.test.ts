import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { Pool } from "pg";

// This is intentionally not a rehearsal of the incomplete historical migration
// chain. It creates only the real prerequisite tables queried by the reference
// API, applies the shipped 0010 and 0011 SQL migrations, and drops its own DB.
const adminDatabaseUrl = process.env.BUNCH_REFERENCE_TEST_DATABASE_URL;
const integrationTest = adminDatabaseUrl ? test : test.skip;

function temporaryDatabaseUrl(connectionString: string, databaseName: string) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function quotedDatabaseName(name: string) {
  assert.match(name, /^bunch_reference_api_it_[a-z0-9_]+$/);
  return `"${name}"`;
}

const prerequisiteSchema = `
  create extension if not exists pgcrypto;

  create table app_user (
    id text primary key,
    google_subject text unique not null,
    created_at timestamptz not null default now()
  );

  create table alter_profile (
    id uuid primary key default gen_random_uuid(),
    owner_id text not null references app_user(id) on delete cascade,
    name text not null,
    pronouns text,
    species text,
    visual_description text,
    presentation text,
    signature_traits text[] not null default '{}',
    image_do_not_change text[] not null default '{}',
    version integer not null default 1,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint alter_profile_owner_id_id_key unique (owner_id, id)
  );

  create table private_image (
    id uuid primary key default gen_random_uuid(),
    owner_id text not null references app_user(id) on delete cascade,
    alter_id uuid not null,
    storage_key text unique not null,
    content_type text not null,
    is_profile_picture boolean not null default false,
    created_at timestamptz not null default now(),
    constraint private_image_owner_alter_fk foreign key (owner_id, alter_id)
      references alter_profile(owner_id, id) on delete cascade
  );
`;

integrationTest("reference API uses real migrations and denies unselected, archived, and revoked access", async () => {
  const databaseName = `bunch_reference_api_it_${process.pid}_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: adminDatabaseUrl, max: 1 });
  const databaseUrl = temporaryDatabaseUrl(adminDatabaseUrl!, databaseName);
  const uploadDirectory = join(process.cwd(), "private-uploads");
  const storageKeys = [
    `reference-api-it-${randomUUID()}-profile.png`,
    `reference-api-it-${randomUUID()}-appearance.webp`,
    `reference-api-it-${randomUUID()}-gallery.png`,
    `reference-api-it-${randomUUID()}-other.png`,
  ];
  let database: Pool | undefined;

  try {
    await admin.query(`create database ${quotedDatabaseName(databaseName)}`);
    database = new Pool({ connectionString: databaseUrl, max: 2 });
    await database.query(prerequisiteSchema);
    await database.query(await readFile(join(process.cwd(), "drizzle/0010_selected_appearance_reference.sql"), "utf8"));
    await database.query(await readFile(join(process.cwd(), "drizzle/0011_reference_credentials.sql"), "utf8"));

    const ownerId = `test-reference-owner:${randomUUID()}`;
    const otherOwnerId = `test-reference-other:${randomUUID()}`;
    const selectedAlterId = randomUUID();
    const otherAlterId = randomUUID();
    const profileImageId = randomUUID();
    const appearanceImageId = randomUUID();
    const galleryImageId = randomUUID();
    const otherImageId = randomUUID();

    await database.query("insert into app_user (id, google_subject) values ($1, $2), ($3, $4)", [ownerId, `google:${randomUUID()}`, otherOwnerId, `google:${randomUUID()}`]);
    await database.query(`insert into alter_profile (id, owner_id, name, pronouns, species, visual_description, presentation, signature_traits, image_do_not_change)
      values ($1, $2, 'Fixture Mouse', 'they/them', 'mouse', 'gray fur', 'casual', array['round ears'], array['tail']),
             ($3, $4, 'Other Owner', null, null, null, null, '{}', '{}')`, [selectedAlterId, ownerId, otherAlterId, otherOwnerId]);
    await database.query(`insert into private_image (id, owner_id, alter_id, storage_key, content_type, is_profile_picture)
      values ($1, $2, $3, $4, 'image/png', true),
             ($5, $2, $3, $6, 'image/webp', false),
             ($7, $2, $3, $8, 'image/png', false),
             ($9, $10, $11, $12, 'image/png', true)`, [
      profileImageId, ownerId, selectedAlterId, storageKeys[0],
      appearanceImageId, storageKeys[1],
      galleryImageId, storageKeys[2],
      otherImageId, otherOwnerId, otherAlterId, storageKeys[3],
    ]);
    await database.query("update alter_profile set appearance_reference_image_id = $1::uuid where id = $2::uuid", [appearanceImageId, selectedAlterId]);

    await mkdir(uploadDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(uploadDirectory, storageKeys[0]), Buffer.from([1, 2, 3])),
      writeFile(join(uploadDirectory, storageKeys[1]), Buffer.from([4, 5, 6])),
      writeFile(join(uploadDirectory, storageKeys[2]), Buffer.from([7, 8, 9])),
      writeFile(join(uploadDirectory, storageKeys[3]), Buffer.from([10, 11, 12])),
    ]);

    process.env.DATABASE_URL = databaseUrl;
    process.env.SYSTEM_DEMO_MODE = "true";
    process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch-reference-integration.example";

    const { referenceApi, sha256, ReferenceValidationError } = await import("@/server/reference-api");
    const { GET: manifest } = await import("@/app/api/reference/v1/manifest/route");
    const { GET: image } = await import("@/app/api/reference/v1/images/[imageId]/route");

    const issued = await referenceApi.issue(ownerId, { label: "Disposable Working Monkey", selectedAlterIds: [selectedAlterId, selectedAlterId] });
    assert.match(issued.secret, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(issued.selectedAlterIds, [selectedAlterId]);
    const storedCredential = await database.query<{ token_hash: string }>("select token_hash from reference_credential where id = $1::uuid", [issued.id]);
    assert.equal(storedCredential.rows[0].token_hash, sha256(issued.secret));
    assert.equal(JSON.stringify(await referenceApi.list(ownerId)).includes(issued.secret), false);
    await assert.rejects(
      () => referenceApi.issue(ownerId, { label: "Cross-owner", selectedAlterIds: [otherAlterId] }),
      (error) => error instanceof ReferenceValidationError && /belong to this account/i.test(error.message),
    );

    const manifestResponse = await manifest(new Request("https://ignored.example/api/reference/v1/manifest", { headers: { authorization: `Bearer ${issued.secret}` } }));
    assert.equal(manifestResponse.status, 200);
    assert.equal(manifestResponse.headers.get("cache-control"), "private, no-store");
    const payload = await manifestResponse.json() as { origin: string; manifestVersion: number; selectedAlterIds: string[]; alters: Array<{ id: string; sha256: string }>; images: Array<{ id: string; alterId: string; version: number; sha256: string }> };
    assert.equal(payload.origin, "https://bunch-reference-integration.example");
    assert.equal(payload.manifestVersion, 1);
    assert.deepEqual(payload.selectedAlterIds, [selectedAlterId]);
    assert.deepEqual(payload.alters.map((alter) => alter.id), [selectedAlterId]);
    assert.match(payload.alters[0].sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(payload.images.map((entry) => entry.id).sort(), [appearanceImageId, profileImageId].sort());
    assert.ok(payload.images.every((entry) => entry.alterId === selectedAlterId && entry.version === 1));
    assert.equal(JSON.stringify(payload).toLowerCase().includes("storagekey"), false);
    assert.equal(JSON.stringify(payload).toLowerCase().includes("gallery"), false);

    const imageResponse = await image(new Request(`https://ignored.example/api/reference/v1/images/${profileImageId}`, { headers: { authorization: `Bearer ${issued.secret}` } }), { params: Promise.resolve({ imageId: profileImageId }) });
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("cache-control"), "private, no-store");
    assert.equal(imageResponse.headers.get("x-reference-version"), "1");
    assert.equal(imageResponse.headers.get("etag"), `\"${sha256(new Uint8Array([1, 2, 3]))}\"`);
    assert.deepEqual([...new Uint8Array(await imageResponse.arrayBuffer())], [1, 2, 3]);
    const lastUsed = await database.query<{ last_used_at: Date | null }>("select last_used_at from reference_credential where id = $1::uuid", [issued.id]);
    assert.ok(lastUsed.rows[0].last_used_at);

    const galleryResponse = await image(new Request(`https://ignored.example/api/reference/v1/images/${galleryImageId}`, { headers: { authorization: `Bearer ${issued.secret}` } }), { params: Promise.resolve({ imageId: galleryImageId }) });
    assert.equal(galleryResponse.status, 401);

    await database.query("update alter_profile set archived_at = now() where id = $1::uuid", [selectedAlterId]);
    const archivedResponse = await manifest(new Request("https://ignored.example/api/reference/v1/manifest", { headers: { authorization: `Bearer ${issued.secret}` } }));
    assert.equal(archivedResponse.status, 401);
    await database.query("update alter_profile set archived_at = null where id = $1::uuid", [selectedAlterId]);

    assert.equal(await referenceApi.revoke(ownerId, issued.id), true);
    const revokedResponse = await manifest(new Request("https://ignored.example/api/reference/v1/manifest", { headers: { authorization: `Bearer ${issued.secret}` } }));
    assert.equal(revokedResponse.status, 401);
  } finally {
    // referenceApi owns its own cached pool; close it before dropping this DB.
    const referencePool = (globalThis as typeof globalThis & { systemPool?: Pool }).systemPool;
    await referencePool?.end();
    delete (globalThis as typeof globalThis & { systemPool?: Pool }).systemPool;
    await database?.end();
    await Promise.all(storageKeys.map((key) => unlink(join(uploadDirectory, key)).catch(() => undefined)));
    await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [databaseName]).catch(() => undefined);
    await admin.query(`drop database if exists ${quotedDatabaseName(databaseName)}`).catch(() => undefined);
    await admin.end();
  }
});
