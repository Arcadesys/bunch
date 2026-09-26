import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { ImageDeletionService } from "./image-deletion";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("owners delete uploads, generated scenes and group renders with their repairs", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `image_deletion_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  const removed: string[][] = [], purged: string[] = [];
  const images = new ImageDeletionService(pool, {
    removeFiles: async (keys) => { removed.push(keys); },
    purgeSharedGalleryCache: async (id) => { purged.push(id); return { deleted: true }; },
  });
  const owner = "auth0:image-owner", other = "auth0:image-other";
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort())
      await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    await pool.query("insert into app_user(id,google_subject) values($1,$1),($2,$2)", [owner, other]);
    await pool.query("insert into pilot_account(owner_id,role,state) values($1,'OPERATOR','ACTIVE'),($2,'FRIEND','ACTIVE')", [owner, other]);
    const alter = randomUUID();
    await pool.query("insert into alter_profile(id,owner_id,name) values($1,$2,'Photo profile')", [alter, owner]);

    const upload = randomUUID();
    await pool.query("insert into private_image(id,owner_id,alter_id,storage_key,content_type) values($1,$2,$3,'k-upload','image/png')", [upload, owner, alter]);
    const render = (sql: string, id: string, key: string | null, state = "COMPLETE", source?: string) =>
      pool.query(`insert into native_scene_render(id,owner_id,request_id,state,model,recipe,storage_key,content_type,content_hash,width,height${source ? `,${sql}` : ""})
        values($1,$2,$3,$4,'m','{}'::jsonb,$5,$6,$7,$8,$8${source ? ",$9" : ""})`,
        [id, owner, randomUUID(), state, key, key && "image/jpeg", key && "h", key && 1, ...(source ? [source] : [])]);
    const rendition = (column: string, source: string, key: string) =>
      pool.query(`insert into image_rendition(owner_id,${column},rendition,storage_key,content_type,content_hash,width,height,byte_size) values($1,$2,'w256-v1',$3,'image/webp',$4,1,1,1)`,
        [owner, source, key, "a".repeat(64)]);
    // upload -> repair -> repair of repair
    const uploadRepair = randomUUID(), uploadRepair2 = randomUUID();
    await render("source_private_id", uploadRepair, "k-upload-r1", "COMPLETE", upload);
    await render("source_native_id", uploadRepair2, "k-upload-r2", "COMPLETE", uploadRepair);
    // scene -> repair; plus a still-running scene
    const scene = randomUUID(), sceneRepair = randomUUID(), running = randomUUID();
    await render("", scene, "k-scene");
    await render("source_native_id", sceneRepair, "k-scene-r1", "COMPLETE", scene);
    await render("", running, null, "RUNNING");
    // group project -> render -> native repair
    const project = randomUUID(), group = randomUUID(), groupRepair = randomUUID();
    await pool.query("insert into group_photo_project(id,owner_id,backplate_storage_key,backplate_content_type,scene_analysis) values($1,$2,'k-backplate','image/png','{}'::jsonb)", [project, owner]);
    await pool.query("insert into group_photo_render(id,owner_id,project_id,request_id,source_version,state,model,recipe,storage_key,content_type,content_hash,width,height) values($1,$2,$3,$4,1,'COMPLETE','m','{}'::jsonb,'k-group','image/jpeg','h',1,1)", [group, owner, project, randomUUID()]);
    await render("source_group_id", groupRepair, "k-group-r1", "COMPLETE", group);
    await rendition("source_private_id", upload, "k-upload-w256");
    await rendition("source_native_id", uploadRepair2, "k-upload-r2-w256");
    await rendition("source_native_id", scene, "k-scene-w256");
    await rendition("source_group_id", group, "k-group-w256");
    await rendition("source_native_id", groupRepair, "k-group-r1-w256");
    await pool.query("insert into image_usage(owner_id,job_kind,job_id,state) values($1,'native',$2,'DISPATCHED')", [owner, scene]);
    await pool.query("insert into pilot_upload(storage_key,owner_id,bytes,state) values('k-scene',$1,10,'STORED'),('k-upload',$1,10,'STORED')", [owner]);
    const count = async (table: string, id: string) => Number((await pool.query(`select count(*) from ${table} where id=$1`, [id])).rows[0].count);

    // Another owner cannot touch these images.
    assert.deepEqual(await images.delete(other, "scene", scene), { deleted: false });
    assert.deepEqual(await images.delete(other, "upload", upload), { deleted: false });
    assert.equal(await count("native_scene_render", scene), 1);
    assert.equal(removed.length, 0);

    // A render that is still being made cannot be deleted.
    await assert.rejects(images.delete(owner, "scene", running), (e: Error) => e.message.startsWith("CONFLICT"));

    // Generated scene: files for it and its repair go, spend ledger stays.
    assert.deepEqual(await images.delete(owner, "scene", scene), { deleted: true });
    assert.deepEqual(removed.pop()?.sort(), ["k-scene", "k-scene-r1", "k-scene-w256"]);
    assert.equal(await count("native_scene_render", scene), 0);
    assert.equal(await count("native_scene_render", sceneRepair), 0);
    assert.equal(Number((await pool.query("select count(*) from image_usage where job_id=$1", [scene])).rows[0].count), 1);
    assert.equal(Number((await pool.query("select count(*) from pilot_upload where storage_key='k-scene'")).rows[0].count), 0);
    // Retrying is safe.
    assert.deepEqual(await images.delete(owner, "scene", scene), { deleted: false });

    // Group render: its native repair goes too; the project and backplate stay.
    assert.deepEqual(await images.delete(owner, "group", group), { deleted: true });
    assert.deepEqual(removed.pop()?.sort(), ["k-group", "k-group-r1", "k-group-r1-w256", "k-group-w256"]);
    assert.equal(await count("group_photo_render", group), 0);
    assert.equal(await count("native_scene_render", groupRepair), 0);
    assert.equal(await count("group_photo_project", project), 1);

    // Revoked owners can still delete their uploads, including repair chains.
    await pool.query("update pilot_account set state='REVOKED' where owner_id=$1", [owner]);
    const before = Number((await pool.query("select version from alter_profile where id=$1", [alter])).rows[0].version);
    assert.deepEqual(await images.delete(owner, "upload", upload), { deleted: true });
    assert.deepEqual(removed.pop()?.sort(), ["k-upload", "k-upload-r1", "k-upload-r2", "k-upload-r2-w256", "k-upload-w256"]);
    assert.deepEqual(purged, [upload]);
    assert.equal(await count("private_image", upload), 0);
    assert.equal(await count("native_scene_render", uploadRepair2), 0);
    assert.equal(Number((await pool.query("select version from alter_profile where id=$1", [alter])).rows[0].version), before + 1);

    // Accounts being deleted, or unenrolled owners behind the gate, cannot.
    await pool.query("update pilot_account set state='DELETING' where owner_id=$1", [owner]);
    await assert.rejects(images.delete(owner, "scene", running), (e: Error) => e.message.startsWith("FORBIDDEN"));
    await pool.query("delete from pilot_account where owner_id=$1", [other]);
    await pool.query("update pilot_policy set gate_enabled=true where id");
    await assert.rejects(images.delete(other, "scene", scene), (e: Error) => e.message.startsWith("FORBIDDEN"));
  } finally {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
