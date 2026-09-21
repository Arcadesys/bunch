import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("image renditions stay owner scoped, unique, and cascade with their source", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `image_rendition_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: `-c search_path=${schema},public`,
  });
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    }
    // Access-policy behavior is covered by the pilot suite. This fixture isolates
    // the rendition table's ownership, uniqueness, and cascade constraints.
    await pool.query("alter table image_rendition disable trigger pilot_access_guard");
    const owner = `auth0:rendition-owner:${randomUUID()}`;
    const other = `auth0:rendition-other:${randomUUID()}`;
    const alterId = randomUUID();
    const imageId = randomUUID();
    await pool.query("insert into app_user(id,google_subject) values($1,$1),($2,$2)", [owner, other]);
    await pool.query("insert into alter_profile(id,owner_id,name) values($1,$2,'Rendition fixture')", [alterId, owner]);
    await pool.query(
      "insert into private_image(id,owner_id,alter_id,storage_key,content_type) values($1,$2,$3,$4,'image/png')",
      [imageId, owner, alterId, `profiles/${randomUUID()}.png`],
    );
    const values = [owner, imageId, `profiles/${randomUUID()}.webp`, "a".repeat(64)];
    await pool.query(
      `insert into image_rendition(owner_id,source_private_id,rendition,storage_key,content_type,content_hash,width,height,byte_size)
       values($1,$2,'w256-v1',$3,'image/webp',$4,256,256,1024)`,
      values,
    );
    await assert.rejects(
      pool.query(
        `insert into image_rendition(owner_id,source_private_id,rendition,storage_key,content_type,content_hash,width,height,byte_size)
         values($1,$2,'w256-v1',$3,'image/webp',$4,256,256,1024)`,
        [owner, imageId, `profiles/${randomUUID()}.webp`, "b".repeat(64)],
      ),
      /image_rendition_private_unique/,
    );
    await assert.rejects(
      pool.query(
        `insert into image_rendition(owner_id,source_private_id,rendition,storage_key,content_type,content_hash,width,height,byte_size)
         values($1,$2,'w512-v1',$3,'image/webp',$4,512,512,2048)`,
        [other, imageId, `profiles/${randomUUID()}.webp`, "c".repeat(64)],
      ),
      /image_rendition_owner_id_source_private_id_fkey/,
    );
    await pool.query("delete from private_image where owner_id=$1 and id=$2", [owner, imageId]);
    assert.equal((await pool.query("select 1 from image_rendition")).rowCount, 0);
  } finally {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
