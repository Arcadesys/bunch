import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { defaultStickerSlots } from "@/domain/sticker-pack";
import { StickerPackService } from "./sticker-pack-service";
import { SystemError } from "./system-error";
import { SystemService } from "./system-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("sticker packs are owner-scoped, versioned, idempotent, and preserve authorship boundaries", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const systems = new SystemService(pool, async () => undefined);
  const stickers = new StickerPackService(pool);
  const owner = `test:${randomUUID()}`;
  const other = `test:${randomUUID()}`;
  try {
    const person = (await systems.createAlter(owner, {
      requestId: randomUUID(),
      name: "Sticker Person",
      communicationGuidance: "Dry delivery, expressive hands.",
    }, "SYSTEM")).data;
    await systems.createAlter(other, { requestId: randomUUID(), name: "Other Person" }, "SYSTEM");

    const slots = defaultStickerSlots().map((slot) => ({
      ...slot,
      performance: `Personal performance for ${slot.intent}`,
    }));
    const requestId = randomUUID();
    const first = await stickers.save(owner, person.id, {
      requestId,
      expectedVersion: null,
      communicationProfile: "Dry delivery, expressive hands.",
      status: "APPROVED",
      slots,
      telegramUrl: null,
    }, "MCP");
    assert.equal(first.replayed, false);
    assert.equal(first.data.status, "APPROVED");
    assert.equal(first.data.slots.length, 10);
    assert.equal(first.data.alterName, "Sticker Person");

    const replay = await stickers.save(owner, person.id, {
      requestId,
      expectedVersion: null,
      communicationProfile: "Ignored replay body",
      status: "DRAFT",
      slots,
      telegramUrl: null,
    }, "MCP");
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.data, first.data);

    await assert.rejects(
      () => stickers.save(owner, person.id, {
        requestId: randomUUID(),
        expectedVersion: first.data.version + 10,
        communicationProfile: first.data.communicationProfile,
        status: "APPROVED",
        slots,
        telegramUrl: null,
      }, "MCP"),
      (error) => error instanceof SystemError && error.code === "CONFLICT",
    );
    await assert.rejects(
      () => stickers.get(other, person.id),
      (error) => error instanceof SystemError && error.code === "NOT_FOUND",
    );

    const published = await stickers.save(owner, person.id, {
      requestId: randomUUID(),
      expectedVersion: first.data.version,
      communicationProfile: first.data.communicationProfile,
      status: "PUBLISHED",
      slots,
      telegramUrl: "https://t.me/addstickers/sticker_person_by_bot",
    }, "MCP");
    assert.equal(published.data.status, "PUBLISHED");
    assert.equal(published.data.telegramUrl, "https://t.me/addstickers/sticker_person_by_bot");

    const events = await pool.query(
      "select actor_alter_id,entity_type,to_status from activity_event where owner_id=$1 and entity_type='STICKER_PACK' order by created_at",
      [owner],
    );
    assert.equal(events.rowCount, 2, "replay and rejected stale writes must not add activity");
    assert.ok(events.rows.every((row) => row.actor_alter_id === null), "the sticker subject is not automatically the activity actor");
    assert.deepEqual(events.rows.map((row) => row.to_status), ["APPROVED", "PUBLISHED"]);
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [[owner, other]]).catch(() => undefined);
    await pool.end();
  }
});
