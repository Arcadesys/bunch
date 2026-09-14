import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { nativeSceneInputSchema } from "@/domain/native-scene";
import { NativeSceneService } from "./native-scene-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

test("native scene input allows prompt-only and caps named participants", () => {
  assert.deepEqual(nativeSceneInputSchema.parse({ scene: "A quiet room", requestId: randomUUID() }).alterNames, []);
  assert.equal(nativeSceneInputSchema.safeParse({ scene: "x", requestId: randomUUID(), alterNames: Array.from({ length: 13 }, (_, index) => `Person ${index}`) }).success, false);
});

integration("prompt-only native scenes claim once and save a normalized private result", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `native_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter(file => file.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    const image = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#123456" } }).png().toBuffer();
    const stored = new Map<string, Uint8Array>(); let calls = 0;
    const service = new NativeSceneService(pool, {
      available: () => true,
      provider: async input => { calls++; assert.equal(input.references.length, 0); assert.equal(input.size, "1024x1024"); return image; },
      saveImage: async (_owner, file) => { const key = `scene-${calls}`; stored.set(key, new Uint8Array(await file.arrayBuffer())); return { storageKey: key, contentType: file.type }; },
      readImage: async key => ({ body: new Blob([(stored.get(key) ?? new Uint8Array()).buffer as ArrayBuffer]), contentType: "image/jpeg" }),
      removeImages: async keys => { keys.forEach(key => stored.delete(key)); },
    });
    const owner = `native:${randomUUID()}`; const requestId = randomUUID();
    const first = await service.start(owner, { scene: "A quiet room", requestId });
    const replay = await service.start(owner, { scene: "A quiet room", requestId });
    assert.equal(first.id, replay.id);
    await service.process(owner, first.id); await service.process(owner, first.id);
    const complete = await service.get(owner, first.id);
    assert.equal(complete.state, "COMPLETE"); assert.equal(calls, 1); assert.match(complete.contentHash!, /^[a-f0-9]{64}$/);
    await assert.rejects(service.get("other-owner", first.id), /not found/i);
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});
