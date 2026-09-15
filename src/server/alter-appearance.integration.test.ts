import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { SystemError } from "@/server/system-error";
import { SystemService } from "@/server/system-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

integration("appearance references persist privately, replace atomically, and do not promote a profile picture", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `appearance_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  const service = new SystemService(pool);
  const owner = `test:${randomUUID()}`;
  const otherOwner = `test:${randomUUID()}`;
  const requestId = () => randomUUID();

  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter((name) => name.endsWith(".sql")).sort()) {
      await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    }

    const alter = await service.createAlter(owner, { requestId: requestId(), name: "Fixture One" }, "WEB");
    const otherAlter = await service.createAlter(otherOwner, { requestId: requestId(), name: "Fixture Two" }, "WEB");
    const firstImage = randomUUID();
    const secondImage = randomUUID();
    const foreignImage = randomUUID();
    await pool.query(
      `insert into private_image (id, owner_id, alter_id, storage_key, content_type)
       values ($1, $2, $3, $4, 'image/png'), ($5, $2, $3, $6, 'image/png'), ($7, $8, $9, $10, 'image/png')`,
      [firstImage, owner, alter.data.id, `fixtures/${firstImage}.png`, secondImage, `fixtures/${secondImage}.png`, foreignImage, otherOwner, otherAlter.data.id, `fixtures/${foreignImage}.png`],
    );
    const promoted = await service.setProfilePicture(owner, alter.data.id, { imageId: firstImage, expectedVersion: 1, requestId: requestId() }, "WEB");

    const firstRequest = requestId();
    const selected = await service.setAlterAppearance(owner, alter.data.id, {
      appearanceNotes: "Synthetic fixture notes.", referenceImageIds: [firstImage, secondImage], expectedVersion: promoted.data.version, requestId: firstRequest,
    }, "WEB");
    assert.equal(selected.data.profilePicture?.id, firstImage);
    assert.deepEqual(selected.data.appearanceReferenceImageIds.sort(), [firstImage, secondImage].sort());
    assert.equal(selected.data.appearanceNotes, "Synthetic fixture notes.");
    const replay = await service.setAlterAppearance(owner, alter.data.id, {
      appearanceNotes: "Ignored retry", referenceImageIds: [], expectedVersion: promoted.data.version, requestId: firstRequest,
    }, "WEB");
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.data, selected.data);

    const replaced = await service.setAlterAppearance(owner, alter.data.id, {
      appearanceNotes: null, referenceImageIds: [secondImage], expectedVersion: selected.data.version, requestId: requestId(),
    }, "MCP");
    assert.equal(replaced.data.profilePicture?.id, firstImage, "reference selection must not promote a profile picture");
    assert.deepEqual(replaced.data.appearanceReferenceImageIds, [secondImage]);
    assert.equal(replaced.data.appearanceNotes, undefined);
    await assert.rejects(
      () => service.setAlterAppearance(owner, alter.data.id, { appearanceNotes: "Nope", referenceImageIds: [foreignImage], expectedVersion: replaced.data.version, requestId: requestId() }, "WEB"),
      (error) => error instanceof SystemError && error.code === "VALIDATION_ERROR",
    );
    assert.deepEqual((await service.getAlter(owner, alter.data.id)).appearanceReferenceImageIds, [secondImage], "rejected cross-owner selection must not replace the saved references");
  } finally {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
