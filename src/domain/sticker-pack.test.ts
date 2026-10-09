import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultStickerSlots,
  saveStickerPackSchema,
  stickerSlotsSchema,
} from "./sticker-pack";

test("sticker pack defaults are ten unique semantic slots", () => {
  const slots = defaultStickerSlots();
  assert.equal(slots.length, 10);
  assert.equal(new Set(slots.map((slot) => slot.stickerId)).size, 10);
  assert.deepEqual(
    slots.map((slot) => slot.stickerId),
    ["yes", "no", "applause", "thanks", "sorry", "laugh", "love", "confused", "congrats", "bye"],
  );
  assert.ok(slots.every((slot) => slot.performance === ""));
});

test("sticker boards require exactly ten unique slots", () => {
  const valid = defaultStickerSlots().map((slot) => ({ ...slot, performance: `Acting for ${slot.intent}` }));
  assert.equal(stickerSlotsSchema.parse(valid).length, 10);
  assert.throws(() => stickerSlotsSchema.parse(valid.slice(0, 9)), /10/);
  const duplicate = valid.map((slot) => ({ ...slot }));
  duplicate[9].stickerId = duplicate[0].stickerId;
  assert.throws(() => stickerSlotsSchema.parse(duplicate), /Duplicate sticker ID/);
});

test("published board requires fields but publication URL policy stays in the service", () => {
  const slots = defaultStickerSlots().map((slot) => ({ ...slot, performance: `Acting for ${slot.intent}` }));
  const parsed = saveStickerPackSchema.parse({
    requestId: "11111111-1111-4111-8111-111111111111",
    expectedVersion: null,
    communicationProfile: "Deadpan, expressive hands.",
    status: "APPROVED",
    slots,
    telegramUrl: null,
  });
  assert.equal(parsed.status, "APPROVED");
  assert.equal(parsed.slots.length, 10);
});
