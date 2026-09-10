import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import sharp from "sharp";
import { GroupPhotoService } from "./group-photo-service";
import { GroupPhotoRenderService } from "./group-photo-render-service";
import { SystemService } from "./system-service";
import { normalizeFinishedPhoto } from "./group-photo-provider";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("finisher persists real decoded bytes and isolates retries, ownership, failure and selected identity", async () => {
  process.env.ERASURE_TOKEN_SIGNING_SECRET = "synthetic-finisher-erasure-test-secret-only";
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `photo_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    const owner = `photo:${randomUUID()}`;
    const service = new SystemService(pool, async keys => { keys.forEach(key => storage.delete(key)); });
    const person = (await service.createAlter(owner, { requestId: randomUUID(), name: "Fixture fox", species: "fox", visualDescription: "Orange fox with a blue scarf", imageDoNotChange: ["blue scarf"] }, "WEB")).data;
    const referenceId = randomUUID();
    await pool.query("insert into private_image(id,owner_id,alter_id,storage_key,content_type) values($1,$2,$3,'selected-reference','image/png')", [referenceId, owner, person.id]);
    const groups = new GroupPhotoService(pool);
    const initial = await groups.create(owner, { storageKey: "scene", contentType: "image/png" });
    const project = await groups.savePlacement(owner, initial.id, { alterId: person.id, tokenX: 20, tokenY: 65, depth: 80 }, 1);
    let calls = 0, saves = 0, fail = false;
    let duringGeneration: (() => Promise<void>) | undefined;
    const image = await sharp({ create: { width: 768, height: 512, channels: 3, background: "#193049" } }).png().toBuffer();
    const storage = new Map<string, Uint8Array>([["scene", image], ["selected-reference", image]]);
    const runner = new GroupPhotoRenderService(pool, {
      available: () => true,
      provider: async input => {
        calls++;
        assert.equal(input.images.length, 2);
        assert.match(input.prompt, /x 20%, y 65%, layer depth 80/);
        assert.match(input.prompt, /blue scarf/);
        assert.match(input.prompt, /Image 2 is the selected appearance reference/);
        if (duringGeneration) await duringGeneration();
        if (fail) throw new Error("secret=must-never-leak");
        return image;
      },
      readImage: async key => { const bytes = storage.get(key); if (!bytes) throw new Error("Missing fixture"); return { body: new Uint8Array(bytes), contentType: "image/png" }; },
      saveImage: async (_owner, file) => { saves++; const key = `saved-${saves}`; storage.set(key, new Uint8Array(await file.arrayBuffer())); return { storageKey: key, contentType: file.type }; },
      removeImages: async keys => { keys.forEach(key => storage.delete(key)); },
    });
    await assert.rejects(runner.start(owner, project.id, project.version, randomUUID()), /Select an appearance reference/);
    assert.equal(calls, 0);
    await service.setAlterAppearance(owner, person.id, { requestId: randomUUID(), expectedVersion: person.version, referenceImageIds: [referenceId] }, "WEB");
    await assert.rejects(runner.start(owner, project.id, 1, randomUUID()), /scene changed/);
    const requestId = randomUUID();
    const [a, b] = await Promise.all([runner.start(owner, project.id, project.version, requestId), runner.start(owner, project.id, project.version, requestId)]);
    assert.equal(a.id, b.id);
    await assert.rejects(runner.start(owner, project.id, project.version, randomUUID()), /already finishing/);
    await Promise.all([runner.process(owner, a.id), runner.process(owner, a.id)]);
    assert.equal(calls, 1); assert.equal(saves, 1);
    const complete = (await runner.list(owner, project.id))[0];
    assert.equal(complete.state, "COMPLETE"); assert.equal(complete.width, 768); assert.equal(complete.height, 512); assert.match(complete.contentHash!, /^[a-f0-9]{64}$/);
    assert.equal("storage_key" in complete, false);
    assert.equal((await runner.start(owner, project.id, project.version, requestId)).id, a.id);
    const reopened = await runner.image(owner, project.id, a.id);
    assert.equal((await sharp(new Uint8Array(await new Response(reopened.body).arrayBuffer())).metadata()).format, "jpeg");
    await assert.rejects(runner.image("other-owner", project.id, a.id), /not found/);
    assert.deepEqual(await runner.list("other-owner", project.id), []);
    fail = true;
    const second = await runner.start(owner, project.id, project.version, randomUUID());
    await runner.process(owner, second.id);
    assert.equal((await runner.list(owner, project.id))[0].state, "FAILED");
    assert.ok(!(await runner.list(owner, project.id))[0].errorMessage?.includes("secret"));
    assert.equal(saves, 1);
    // Previous successful photo remains available after a failed retry.
    await runner.image(owner, project.id, a.id);
    const third = await runner.start(owner, project.id, project.version, randomUUID());
    await pool.query("update group_photo_render set state='RUNNING',created_at=now()-interval '7 minutes' where id=$1", [third.id]);
    assert.equal((await runner.list(owner, project.id)).find(r => r.id === third.id)?.state, "FAILED");
    await runner.process(owner, third.id); assert.equal(calls, 2);
    fail = false;
    const fourth = await runner.start(owner, project.id, project.version, randomUUID());
    duringGeneration = async () => {
      const preview = await service.previewEraseAlter(owner, person.id);
      assert.equal(preview.canErase, true);
      await service.eraseAlter(owner, person.id, { requestId: randomUUID(), expectedVersion: preview.version, previewToken: preview.previewToken! }, "WEB");
    };
    await runner.process(owner, fourth.id);
    assert.equal(storage.has("saved-1"), false);
    assert.equal(storage.has("saved-2"), false, "in-flight work must not recreate an erased person's photo");
    assert.deepEqual(await runner.list(owner, project.id), []);
    await assert.rejects(runner.image(owner, project.id, a.id), /not found/);
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});

test("provider success must contain a decodable, useful-sized image", async () => {
  await assert.rejects(normalizeFinishedPhoto(new Uint8Array([1, 2, 3])));
  const tiny = await sharp({ create: { width: 10, height: 10, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(normalizeFinishedPhoto(tiny), /usable photo/);
});
