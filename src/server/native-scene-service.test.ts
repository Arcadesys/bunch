import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import sharp from "sharp";
import { nativeSceneInputSchema } from "@/domain/native-scene";
import { NativeSceneService } from "./native-scene-service";
import { SystemService } from "./system-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

test("native scene input allows prompt-only and caps named participants", () => {
  assert.deepEqual(
    nativeSceneInputSchema.parse({
      scene: "A quiet room",
      requestId: randomUUID(),
    }).alterNames,
    [],
  );
  assert.equal(
    nativeSceneInputSchema.safeParse({
      scene: "x",
      requestId: randomUUID(),
      alterNames: Array.from({ length: 13 }, (_, index) => `Person ${index}`),
    }).success,
    false,
  );
});

integration(
  "prompt-only native scenes claim once and save a normalized private result",
  async () => {
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `native_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    try {
      await pool.query(await readFile("db/baseline.sql", "utf8"));
      for (const file of (await readdir("drizzle"))
        .filter((file) => file.endsWith(".sql"))
        .sort())
        await pool.query(await readFile(`drizzle/${file}`, "utf8"));
      const image = await sharp({
        create: { width: 512, height: 512, channels: 3, background: "#123456" },
      })
        .png()
        .toBuffer();
      const stored = new Map<string, Uint8Array>();
      let calls = 0;
      const service = new NativeSceneService(pool, {
        available: () => true,
        provider: async (input) => {
          calls++;
          assert.equal(input.references.length, 0);
          assert.equal(input.size, "1024x1024");
          return image;
        },
        saveImage: async (_owner, file) => {
          const key = `scene-${calls}`;
          stored.set(key, new Uint8Array(await file.arrayBuffer()));
          return { storageKey: key, contentType: file.type };
        },
        readImage: async (key) => ({
          body: new Blob([
            (stored.get(key) ?? new Uint8Array()).buffer as ArrayBuffer,
          ]),
          contentType: "image/jpeg",
        }),
        removeImages: async (keys) => {
          keys.forEach((key) => stored.delete(key));
        },
      });
      const owner = `native:${randomUUID()}`;
      const requestId = randomUUID();
      const first = await service.start(owner, {
        scene: "A quiet room",
        requestId,
      });
      const replay = await service.start(owner, {
        scene: "A quiet room",
        requestId,
      });
      assert.equal(first.id, replay.id);
      await service.process(owner, first.id);
      await service.process(owner, first.id);
      const complete = await service.get(owner, first.id);
      assert.equal(complete.state, "COMPLETE");
      assert.equal(calls, 1);
      assert.match(complete.contentHash!, /^[a-f0-9]{64}$/);
      await assert.rejects(service.get("other-owner", first.id), /not found/i);
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  },
);

integration(
  "named native scenes preserve three selected references without leaking stored identifiers",
  async () => {
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `native_refs_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    try {
      await pool.query(await readFile("db/baseline.sql", "utf8"));
      for (const file of (await readdir("drizzle"))
        .filter((file) => file.endsWith(".sql"))
        .sort())
        await pool.query(await readFile(`drizzle/${file}`, "utf8"));
      const owner = `native_refs:${randomUUID()}`;
      const profiles = new SystemService(pool);
      const one = (
        await profiles.createAlter(
          owner,
          {
            requestId: randomUUID(),
            name: "One",
            species: "hare",
            visualDescription: "A violet hare",
          },
          "WEB",
        )
      ).data;
      const two = (
        await profiles.createAlter(
          owner,
          {
            requestId: randomUUID(),
            name: "Two",
            species: "fox",
            visualDescription: "An amber fox",
          },
          "WEB",
        )
      ).data;
      const referenceIds = [randomUUID(), randomUUID(), randomUUID()];
      for (const [index, id] of referenceIds.entries())
        await pool.query(
          "insert into private_image(id,owner_id,alter_id,storage_key,content_type) values($1,$2,$3,$4,'image/png')",
          [id, owner, index < 2 ? one.id : two.id, `reference-${index}`],
        );
      const oneSelected = (
        await profiles.setAlterAppearance(
          owner,
          one.id,
          {
            requestId: randomUUID(),
            expectedVersion: one.version,
            appearanceNotes: "Silver pendant",
            referenceImageIds: referenceIds.slice(0, 2),
          },
          "WEB",
        )
      ).data;
      await profiles.setAlterAppearance(
        owner,
        two.id,
        {
          requestId: randomUUID(),
          expectedVersion: two.version,
          appearanceNotes: "Blue scarf",
          referenceImageIds: [referenceIds[2]],
        },
        "WEB",
      );
      const image = await sharp({
        create: { width: 512, height: 512, channels: 3, background: "#123456" },
      })
        .png()
        .toBuffer();
      const storage = new Map(
        referenceIds.map((id, index) => [
          `reference-${index}`,
          new Uint8Array(image),
        ]),
      );
      let mutateDuringProvider = false;
      const service = new NativeSceneService(pool, {
        available: () => true,
        provider: async (input) => {
          assert.deepEqual(
            input.references.map((reference) => reference.name),
            [
              "reference-person-1-1",
              "reference-person-2-1",
              "reference-person-2-2",
            ],
          );
          assert.match(input.prompt, /Silver pendant/);
          assert.match(input.prompt, /Blue scarf/);
          assert.doesNotMatch(input.prompt, new RegExp(oneSelected.id));
          assert.doesNotMatch(input.prompt, new RegExp(referenceIds[0]));
          if (mutateDuringProvider) {
            const current = await profiles.getAlter(owner, one.id);
            await profiles.setAlterAppearance(
              owner,
              one.id,
              {
                requestId: randomUUID(),
                expectedVersion: current.version,
                appearanceNotes: "Changed during generation",
                referenceImageIds: referenceIds.slice(0, 2),
              },
              "WEB",
            );
          }
          return image;
        },
        readImage: async (key) => ({
          body: new Blob([
            (storage.get(key) ?? new Uint8Array()).buffer as ArrayBuffer,
          ]),
          contentType: "image/png",
        }),
        saveImage: async () => ({
          storageKey: "result",
          contentType: "image/jpeg",
        }),
        removeImages: async () => {},
      });
      const requestId = randomUUID();
      const render = await service.start(owner, {
        scene: "Friends together",
        alterNames: ["Two", "One"],
        requestId,
      });
      await assert.rejects(
        service.start(owner, {
          scene: "Different scene",
          alterNames: ["Two", "One"],
          requestId,
        }),
        /different scene input/,
      );
      await service.process(owner, render.id);
      assert.equal((await service.get(owner, render.id)).state, "COMPLETE");
      mutateDuringProvider = true;
      const stale = await service.start(owner, {
        scene: "Friends together again",
        alterNames: ["Two", "One"],
        requestId: randomUUID(),
      });
      await service.process(owner, stale.id);
      assert.equal((await service.get(owner, stale.id)).state, "FAILED");
      const limited = new NativeSceneService(pool, {
        available: () => true,
        dailyLimit: 1,
      });
      await assert.rejects(
        limited.start(owner, { scene: "Quota check", requestId: randomUUID() }),
        /daily native-scene limit/,
      );
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  },
);
