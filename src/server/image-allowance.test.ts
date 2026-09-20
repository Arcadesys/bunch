import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { ImageAllowanceService } from "./image-allowance";
import { NativeSceneService } from "./native-scene-service";
import { GroupPhotoRenderService } from "./group-photo-render-service";
import { GroupPhotoService } from "./group-photo-service";
import { SystemService } from "./system-service";
import { PilotService } from "./pilot-service";
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("image allowance shares atomic admission, accounts for failures, and preserves repair privacy", async () => {
  process.env.ERASURE_TOKEN_SIGNING_SECRET = "synthetic-allowance-erasure-only";
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `allowance_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    const owner = `pilot:${randomUUID()}`, operator = `operator:${randomUUID()}`, other = `other:${randomUUID()}`;
    for (const id of [owner, operator, other]) await pool.query("insert into app_user(id,google_subject) values($1,$1)", [id]);
    await pool.query("insert into pilot_account(owner_id,role) values($1,'FRIEND'),($2,'OPERATOR'),($3,'FRIEND')", [owner, operator, other]);
    await pool.query("update pilot_policy set gate_enabled=true,friends_enabled=true,uploads_enabled=true,capacity_verified_at=now(),recovery_verified_at=now()");
    const allowance = new ImageAllowanceService(pool);
    assert.equal((await allowance.read(owner)).limit, 10);
    assert.equal((await allowance.read(operator)).limit, 20);
    await assert.rejects(allowance.setLimit(owner, owner, 100), /Only the active/);
    const image = await sharp({ create: { width: 768, height: 512, channels: 3, background: "#335577" } }).png().toBuffer();
    const blobs = new Map<string, Uint8Array>();
    let calls = 0, failProvider = false;
    let duringProvider: (() => Promise<void>) | undefined;
    const deps = {
      available: () => true,
      readImage: async (key: string) => ({ body: new Blob([new Uint8Array(blobs.get(key) ?? image)]), contentType: "image/png" }),
      saveImage: async (id: string, file: File) => { const key = randomUUID(); blobs.set(key, new Uint8Array(await file.arrayBuffer())); await pool.query("insert into pilot_upload(storage_key,owner_id,bytes,state) values($1,$2,$3,'STORED')", [key, id, file.size]); return { storageKey: key, contentType: file.type }; },
      removeImages: async (keys: string[]) => { for (const key of keys) blobs.delete(key); await pool.query("delete from pilot_upload where storage_key=any($1::text[])", [keys]); },
    };
    const service = new NativeSceneService(pool, { ...deps, provider: async input => { calls++; if (failProvider) throw new Error("provider secret"); if (input.references.length) assert.equal(input.size, "1536x1024"); await input.onUsage?.({ input_tokens: 11, output_tokens: 22, input_text_tokens: 5, input_image_tokens: 6, output_image_tokens: 22 }); await duringProvider?.(); return image; } });
    const create = (scene = "Synthetic scene") => ({ scene, requestId: randomUUID() });
    await pool.query("update pilot_account set quota_bytes=1 where owner_id=$1", [owner]);
    await assert.rejects(service.start(owner, create()), /Private image storage is full/);
    assert.equal(calls, 0);
    assert.equal((await allowance.read(owner)).reserved, 0);
    await pool.query("update pilot_account set quota_bytes=52428800 where owner_id=$1", [owner]);
    await allowance.setLimit(operator, owner, 1);
    const admissions = await Promise.allSettled([service.start(owner, create()), service.start(owner, create())]);
    assert.equal(admissions.filter(r => r.status === "fulfilled").length, 1);
    const admitted = admissions.find(r => r.status === "fulfilled")! as PromiseFulfilledResult<Awaited<ReturnType<typeof service.start>>>;
    assert.equal((await allowance.read(owner)).reserved, 1);
    await Promise.all([service.process(owner, admitted.value.id), service.process(owner, admitted.value.id)]);
    assert.equal(calls, 1);
    assert.equal((await allowance.read(owner)).used, 1);
    const recordedUsage = (await pool.query("select provider_usage,cost_microusd,cost_status,route,model,quality from image_usage where job_id=$1", [admitted.value.id])).rows[0];
    assert.deepEqual(recordedUsage.provider_usage, { input_tokens: 11, output_tokens: 22, input_text_tokens: 5, input_image_tokens: 6, output_image_tokens: 22 });
    assert.equal(Number(recordedUsage.cost_microusd), 733);
    assert.deepEqual({ status: recordedUsage.cost_status, route: recordedUsage.route, model: recordedUsage.model, quality: recordedUsage.quality }, { status: "PROVIDER_CONFIRMED", route: "LEGACY", model: "gpt-image-2.5-sunburst", quality: "high" });
    const system = new SystemService(pool, deps.removeImages);
    const person = (await system.createAlter(owner, { name: "Synthetic person", species: "fox", visualDescription: "Orange fox with a blue scarf", requestId: randomUUID() }, "WEB")).data;
    const reference = randomUUID();
    await pool.query("insert into private_image(id,owner_id,alter_id,storage_key,content_type) values($1,$2,$3,'reference','image/png')", [reference, owner, person.id]);
    await system.setAlterAppearance(owner, person.id, { requestId: randomUUID(), expectedVersion: person.version, referenceImageIds: [reference] }, "WEB");
    const composer = new GroupPhotoService(pool);
    const project = await composer.create(owner, { contentType: "image/png", storageKey: "backplate" });
    const placed = await composer.savePlacement(owner, project.id, { alterId: person.id, tokenX: 50, tokenY: 50, depth: 50 }, project.version);
    const group = new GroupPhotoRenderService(pool, { ...deps, provider: async () => { calls++; return image; } });
    await assert.rejects(group.start(owner, placed.id, placed.version, randomUUID()), /daily image allowance/);
    // Deleting the output never resets spent allowance.
    await pool.query("delete from native_scene_render where id=$1", [admitted.value.id]);
    assert.equal((await allowance.read(owner)).used, 1);
    await allowance.setLimit(operator, owner, 10);
    const groupJob = await group.start(owner, placed.id, placed.version, randomUUID());
    await group.process(owner, groupJob.id);
    assert.equal((await allowance.read(owner)).used, 2);
    const repairInput = { ...create("Correct the background"), repairSource: { kind: "group", id: groupJob.id } };
    const repair = await service.start(owner, repairInput);
    assert.equal((await service.start(owner, repairInput)).id, repair.id);
    await assert.rejects(service.start(owner, { ...repairInput, scene: "Conflicting edit" }), /different scene input/);
    await service.process(owner, repair.id);
    assert.equal((await service.get(owner, repair.id)).state, "COMPLETE");
    const second = await service.start(owner, { ...create("Improve the lighting"), repairSource: { kind: "native", id: repair.id } });
    await service.process(owner, second.id);
    assert.equal((await service.get(owner, second.id)).state, "COMPLETE");
    assert.equal((await pool.query("select recipe->'profiles' as profiles from native_scene_render where id=$1", [second.id])).rows[0].profiles[0].id, person.id);
    await assert.rejects(service.start(other, { ...create(), repairSource: { kind: "native", id: second.id } }), /Repair source/);
    const exported = await new PilotService(pool).export(owner);
    assert.ok(exported.generatedImages.some((d: { id: string }) => d.id === second.id));
    const before = await allowance.read(owner);
    // Missing source before provider dispatch refunds the reservation and cascades repair jobs.
    const privateRepair = await service.start(owner, { ...create("Fix the sleeve"), repairSource: { kind: "private", id: reference } });
    await pool.query("delete from private_image where id=$1", [reference]);
    await service.process(owner, privateRepair.id);
    assert.equal((await allowance.read(owner)).used, before.used);
    assert.equal((await allowance.read(owner)).reserved, 0);
    // Timeout/failed provider counts, with safe public copy and no implicit retry.
    failProvider = true;
    const failed = await service.start(owner, create());
    await service.process(owner, failed.id);
    const countAfterFailure = calls;
    await service.process(owner, failed.id);
    assert.equal(calls, countAfterFailure);
    assert.match((await service.get(owner, failed.id)).errorMessage!, /used 1 image use/);
    assert.ok(!(await service.get(owner, failed.id)).errorMessage!.includes("secret"));
    failProvider = false;
    const queued = await service.start(owner, create());
    await pool.query("update native_scene_render set created_at=now()-interval '7 minutes' where id=$1", [queued.id]);
    await service.list(owner);
    assert.equal((await allowance.read(owner)).reserved, 0);
    // Revocation after admission prevents dispatch and refunds.
    const revoked = await service.start(owner, create());
    await pool.query("update pilot_account set state='REVOKED' where owner_id=$1", [owner]);
    await service.process(owner, revoked.id);
    assert.equal(calls, countAfterFailure);
    await assert.rejects(service.start(owner, create()), /Image access/);
    await pool.query("update pilot_account set state='ACTIVE' where owner_id=$1", [owner]);
    assert.equal((await allowance.read(owner)).reserved, 0);
    // An in-flight erasure prevents attachment and cleans all repair descendants.
    duringProvider = async () => { const preview = await system.previewEraseAlter(owner, person.id); await system.eraseAlter(owner, person.id, { requestId: randomUUID(), expectedVersion: preview.version, previewToken: preview.previewToken! }, "WEB"); };
    const erased = await service.start(owner, { ...create("Fix the sleeve"), repairSource: { kind: "native", id: second.id } });
    await service.process(owner, erased.id);
    assert.equal((await pool.query("select count(*)::int as n from native_scene_render where recipe->'profiles' @> $1::jsonb", [JSON.stringify([{ id: person.id }])])).rows[0].n, 0);
    assert.ok((await allowance.read(owner)).used > before.used);
    await allowance.setLimit(operator, owner, 0);
    await assert.rejects(service.start(owner, create()), /daily image allowance/);
    await allowance.setLimit(operator, owner, null);
    assert.equal((await allowance.read(owner)).limit, 10);
    // Chicago reset spans 23/25 hours at DST boundaries; date admission never follows server timezone.
    const spring = await allowance.read(owner, pool, new Date("2026-03-08T06:00:00Z"));
    const fall = await allowance.read(owner, pool, new Date("2026-11-01T05:00:00Z"));
    assert.equal(spring.resetsAt, "2026-03-09T05:00:00.000Z");
    assert.equal(fall.resetsAt, "2026-11-02T06:00:00.000Z");
    await pool.query("insert into image_usage(owner_id,job_kind,job_id,state,admitted_on) values($1,'native',$2,'DISPATCHED','2026-03-08')", [owner, randomUUID()]);
    assert.equal((await allowance.read(owner, pool, new Date("2026-03-09T04:59:59Z"))).used, 1);
    assert.equal((await allowance.read(owner, pool, new Date("2026-03-09T05:00:00Z"))).used, 0);
    const priorStage = process.env.AI_COST_ROUTING_STAGE;
    process.env.AI_COST_ROUTING_STAGE = "pilot";
    try {
      await pool.query("insert into image_usage(owner_id,job_kind,job_id,state,cost_microusd) values($1,'native',$2,'DISPATCHED',100000)", [other, randomUUID()]);
      assert.equal((await allowance.plan(pool, other, { action: "repair", size: "1024x1024", referenceCount: 1 })).mode, "ECONOMY");
      await pool.query("insert into image_usage(owner_id,job_kind,job_id,state,cost_microusd) values($1,'native',$2,'DISPATCHED',150000)", [other, randomUUID()]);
      const paused = await allowance.plan(pool, other, { action: "generation", size: "1024x1024", referenceCount: 0 });
      assert.equal(paused.mode, "PAUSED");
      await assert.rejects(allowance.transaction(async client => {
        await client.query("select id from app_user where id=$1 for update", [other]);
        await allowance.reserve(client, other, "native", randomUUID(), paused);
      }), /spend ceiling/);
    } finally {
      if (priorStage === undefined) delete process.env.AI_COST_ROUTING_STAGE; else process.env.AI_COST_ROUTING_STAGE = priorStage;
    }
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});

integration("migration backfills recent attempts and queues without recounting older history", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `backfill_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const f of (await readdir("drizzle")).filter(f => f.endsWith(".sql") && !f.startsWith("0022") && !f.startsWith("0023")).sort()) await pool.query(await readFile(`drizzle/${f}`, "utf8"));
    const owner = `backfill:${randomUUID()}`;
    await pool.query("insert into app_user(id,google_subject) values($1,$1)", [owner]);
    for (const [state, age] of [["FAILED", "0 hours"], ["COMPLETE", "0 hours"], ["QUEUED", "1 day"], ["FAILED", "2 days"]]) await pool.query("insert into native_scene_render(owner_id,request_id,model,recipe,state,created_at,storage_key,content_type,content_hash,width,height) values($1,$2::uuid,'synthetic','{}',$3,now()-$4::interval,$2::uuid::text,'image/jpeg','synthetic',512,512)", [owner, randomUUID(), state, age]);
    await pool.query(await readFile("drizzle/0022_image_allowance_repairs.sql", "utf8"));
    await pool.query(await readFile("drizzle/0023_ai_spend_ledger.sql", "utf8"));
    const rows = (await pool.query("select state,count(*)::int as n from image_usage group by state order by state")).rows;
    assert.deepEqual(rows, [{ state: "DISPATCHED", n: 2 }, { state: "RESERVED", n: 1 }]);
    const allowance = new ImageAllowanceService(pool);
    assert.equal((await allowance.read(owner)).used, 2);
    assert.equal((await allowance.read(owner)).reserved, 0);
    await allowance.expire(owner);
    assert.equal((await pool.query("select count(*)::int as n from image_usage where state='RESERVED'")).rows[0].n, 0);
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});
