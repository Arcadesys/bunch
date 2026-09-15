import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { listGeneratedPhotos } from "./generated-gallery";
import { GroupPhotoService } from "./group-photo-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("gallery combines completed outputs, isolates owners, and paginates tied microsecond timestamps without loss", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `gallery_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    const owner = `gallery:${randomUUID()}`, other = `gallery:${randomUUID()}`;
    const project = await new GroupPhotoService(pool).create(owner, { storageKey: "synthetic-backplate", contentType: "image/png" });
    await pool.query("insert into app_user(id,google_subject) values($1,$1)", [other]);
    const expected: string[] = [];
    for (let index = 0; index < 28; index++) {
      const id = randomUUID(); expected.push(id);
      const kind = index % 2 ? "group_photo_render" : "native_scene_render";
      const groupColumns = index % 2 ? ",project_id,source_version" : "";
      const groupValues = index % 2 ? ",$4,1" : "";
      await pool.query(`insert into ${kind}(id,owner_id,request_id,model,recipe,state,storage_key,content_type,content_hash,width,height,created_at${groupColumns}) values($1,$2,$1,'synthetic','{"scene":"Synthetic gallery photo"}','COMPLETE',$3,'image/jpeg','hash',512,512,'2026-09-13T12:00:00.123456Z'${groupValues})`, [id, owner, `private-key-${index}`, ...(index % 2 ? [project.id] : [])]);
    }
    await pool.query("insert into native_scene_render(owner_id,request_id,model,recipe,state) values($1,$3,'synthetic','{}','QUEUED'),($2,$4,'synthetic','{}','FAILED')", [owner, other, randomUUID(), randomUUID()]);
    await pool.query("insert into native_scene_render(owner_id,request_id,model,recipe,state,storage_key,content_type,content_hash,width,height) values($1,$2,'synthetic','{}','COMPLETE','other-secret','image/jpeg','hash',512,512)", [other, randomUUID()]);
    const first = await listGeneratedPhotos(owner, null, pool);
    assert.equal(first.data.length, 24);
    assert.ok(first.meta.nextCursor);
    const second = await listGeneratedPhotos(owner, first.meta.nextCursor, pool);
    assert.equal(second.data.length, 4);
    assert.equal(second.meta.nextCursor, null);
    assert.deepEqual([...first.data, ...second.data].map(photo => photo.id).sort(), expected.sort());
    assert.ok(first.data.some(photo => photo.kind === "group" && photo.imageUrl.includes(`/group-photos/${project.id}/renders/`)));
    assert.ok(first.data.some(photo => photo.kind === "scene" && photo.imageUrl.includes("/native-scenes/renders/")));
    assert.ok(!JSON.stringify(first).includes("private-key"));
    assert.equal((await pool.query("select state from native_scene_render where owner_id=$1 and state='QUEUED'", [owner])).rowCount, 1, "Browsing does not dispatch queued generation");
    await assert.rejects(listGeneratedPhotos(owner, "broken", pool), /invalid/);
    const stranger = await listGeneratedPhotos(`unknown:${randomUUID()}`, first.meta.nextCursor, pool);
    assert.deepEqual(stranger.data, []);
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});
