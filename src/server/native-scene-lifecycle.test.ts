import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { PilotService } from "./pilot-service";
import { SystemService } from "./system-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("native outputs are exportable, person erasure removes all dependent scenes, and account deletion removes reserved blobs", async () => {
  process.env.ERASURE_TOKEN_SIGNING_SECRET = "native-lifecycle-synthetic-erasure-secret";
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `native_lifecycle_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  const removed: string[] = [];
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    const owner = `native-owner:${randomUUID()}`, other = `native-other:${randomUUID()}`;
    const system = new SystemService(pool, async keys => { removed.push(...keys); });
    const person = (await system.createAlter(owner, { requestId: randomUUID(), name: "Synthetic scene person" }, "WEB")).data;
    await system.createAlter(other, { requestId: randomUUID(), name: "Other owner" }, "WEB");
    await pool.query("insert into pilot_account(owner_id,role,state) values($1,'FRIEND','ACTIVE'),($2,'FRIEND','ACTIVE')", [owner, other]);
    await pool.query("update pilot_policy set friends_enabled=true where id");
    const pilot = new PilotService(pool);
    const addOutput = async (who: string, profiles: { id: string; version: number }[], key: string) => {
      const row = (await pool.query("insert into native_scene_render(owner_id,request_id,model,recipe,state,storage_key,content_type,content_hash,width,height) values($1,$2,'synthetic',$3,'COMPLETE',$4,'image/jpeg','synthetic-hash',512,512) returning id", [who, randomUUID(), JSON.stringify({ scene: "Synthetic output", alterNames: [], profiles, references: [] }), key])).rows[0];
      // savePrivateImage uses this reservation ledger for account-wide cleanup.
      await pool.query("insert into pilot_upload(storage_key,owner_id,bytes,state) values($1,$2,1024,'STORED')", [key, who]);
      return row.id as string;
    };
    const dependent = await addOutput(owner, [{ id: person.id, version: person.version }], "dependent-scene-key");
    const independent = await addOutput(owner, [], "prompt-only-key");
    const otherOutput = await addOutput(other, [], "other-owner-key");
    const exported = await pilot.export(owner);
    assert.deepEqual(exported.generatedImages.map(item => item.id).sort(), [dependent, independent].sort());
    assert.ok(exported.generatedImages.every(item => item.downloadUrl === `/api/v1/account/generated-images/${item.id}`));
    assert.equal(exported.data.native_scene_render.length, 2);
    assert.ok(!JSON.stringify(exported).includes("dependent-scene-key"));
    assert.ok(!JSON.stringify(exported).includes(otherOutput));
    const preview = await system.previewEraseAlter(owner, person.id);
    assert.equal(preview.blockers.images, 1);
    await system.eraseAlter(owner, person.id, { requestId: randomUUID(), expectedVersion: preview.version, previewToken: preview.previewToken! }, "WEB");
    assert.deepEqual(removed, ["dependent-scene-key"]);
    assert.equal((await pool.query("select 1 from native_scene_render where id=$1", [dependent])).rowCount, 0);
    assert.equal((await pool.query("select 1 from native_scene_render where id=$1", [independent])).rowCount, 1);
    await pilot.beginDeletion(owner);
    const deletedKeys: string[] = [];
    assert.equal((await pilot.finishDeletion(owner, async keys => { deletedKeys.push(...keys); })).state, "DELETED");
    assert.ok(deletedKeys.includes("prompt-only-key"));
    assert.ok(!deletedKeys.includes("other-owner-key"));
    assert.equal((await pool.query("select 1 from native_scene_render where owner_id=$1", [owner])).rowCount, 0);
    assert.equal((await pool.query("select 1 from native_scene_render where id=$1", [otherOutput])).rowCount, 1);
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});
