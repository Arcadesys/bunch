import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AlterView } from "@/domain/contracts";
import { alterCreateSchema, alterPatchSchema } from "@/domain/contracts";
import { buildAlterImagePrompt } from "@/domain/image-prompt";
import { prepareAlterImagePrompt, prepareFurryScene } from "./image-prompt";

const twi: AlterView = {
  id: randomUUID(), name: "Twilight Arcade", version: 3, aliases: [], strengths: [], boundaries: [], images: [], imageCount: 0,
  appearanceReferenceImageIds: [], createdAt: "2026-09-08T12:00:00.000Z", updatedAt: "2026-09-08T12:00:00.000Z",
  species: "hare", visualDescription: "Elegant indigo-and-violet hare; glasses; nocturnal, composed, dark layered clothing.",
  signatureTraits: ["glasses", "long glorious ears", "cotton tail"], styleTags: ["gothic", "moonlit", "observant"],
  imageDoNotChange: ["species", "palette", "glasses"], description: "Private non-visual biography must not be included",
};

test("canonical Twi identity survives conflicting scene and style requests deterministically", () => {
  const profile = { ...twi, styleTags: [...twi.styleTags!, "orange fox"], appearanceNotes: "Reference sheets show a small silver crescent pendant." };
  const result = buildAlterImagePrompt("Draw everyone as orange foxes without glasses", [profile]);
  assert.deepEqual(result, buildAlterImagePrompt("Draw everyone as orange foxes without glasses", [profile]));
  assert.equal(result.ready, true);
  for (const expected of ["hare", "indigo-and-violet", "glasses", "long glorious ears", "cotton tail", "Keep unchanged: species, palette, glasses", "Canonical identity takes precedence"]) assert.ok(result.prompt.includes(expected));
  assert.equal(result.identities[0].species, "hare");
  assert.equal(result.identities[0].appearanceNotes, "Reference sheets show a small silver crescent pendant.");
  assert.match(result.prompt, /small silver crescent pendant/);
  assert.doesNotMatch(result.prompt, /Private non-visual biography/);
});

test("missing text needs information unless a selected reference exists; gallery alone is insufficient", () => {
  const picture = { id: randomUUID(), contentType: "image/png" as const, isProfilePicture: true, createdAt: twi.createdAt };
  const missing = { ...twi, id: randomUUID(), name: "Reference-only", species: undefined, visualDescription: undefined, images: [picture] };
  const blocked = buildAlterImagePrompt("Draw everyone", [twi, missing]);
  assert.equal(blocked.status, "NEEDS_INFORMATION");
  assert.equal(blocked.identities.length, 2);
  assert.equal(buildAlterImagePrompt("Draw everyone", [{ ...missing, profilePicture: picture }]).status, "NEEDS_INFORMATION", "An avatar is not an implicitly selected appearance reference");
  const ready = buildAlterImagePrompt("Draw everyone", [twi, { ...missing, profilePicture: picture, appearanceReferenceImageIds: [picture.id] }]);
  assert.equal(ready.ready, true);
  assert.equal(ready.identities[1].reliesOnReference, true);
  assert.deepEqual(ready.identities[1].missingFields, ["species", "visualDescription"]);
  assert.equal(buildAlterImagePrompt("Draw everyone", []).ready, false);
});

test("all follows every page and associates reference capabilities with the correct person only in metadata", async () => {
  const secret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "image-prompt-test-secret-with-enough-entropy";
  try {
    const profiles = [twi, { ...twi, id: randomUUID(), name: "Second" }].map((profile) => {
      const picture = { id: randomUUID(), contentType: "image/png" as const, isProfilePicture: false, createdAt: twi.createdAt };
      return { ...profile, appearanceReferenceImageIds: [picture.id], images: [picture] };
    });
    const calls: unknown[] = [];
    const service = {
      async getAlter(owner: string, id: string) { assert.equal(owner, "test:owner"); const profile = profiles.find((item) => item.id === id); if (!profile) throw new Error("Not found"); return profile; },
      async listAlters(owner: string, input: { cursor?: string; includeArchived: boolean }) {
        calls.push(input); assert.equal(owner, "test:owner"); assert.equal(input.includeArchived, false);
        return input.cursor ? { data: [profiles[1]] } : { data: [profiles[0]], nextCursor: "page-two" };
      },
    };
    const result = await prepareAlterImagePrompt(service, "test:owner", { scene: "Draw everyone", alters: "all" }, "https://example.invalid");
    assert.equal(calls.length, 2);
    assert.deepEqual(result.structuredContent.identities.map((identity) => identity.alterId), profiles.map((profile) => profile.id));
    assert.deepEqual(result._meta.referenceMedia.map((media) => [media.alterId, media.imageId]), profiles.map((profile) => [profile.id, profile.appearanceReferenceImageIds[0]]));
    assert.match(JSON.stringify(result._meta), /cap=/);
    assert.doesNotMatch(JSON.stringify([result.structuredContent, result.content]), /cap=|https:|storageKey/);
    const single = await prepareAlterImagePrompt(service, "test:owner", { scene: "Portrait", alters: [twi.id, twi.id] }, "https://example.invalid");
    assert.equal(single.structuredContent.identities.length, 1);
    await assert.rejects(prepareAlterImagePrompt(service, "test:owner", { scene: "Portrait", alters: [randomUUID()] }, "https://example.invalid"), /Not found/);
  } finally {
    if (secret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET; else process.env.MCP_TOKEN_SIGNING_SECRET = secret;
  }
});

test("Furry scene preparation resolves paginated exact aliases and preserves every selected reference grouping", async () => {
  const secret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "image-prompt-test-secret-with-enough-entropy";
  try {
    const oneImages = ["image/png", "image/webp"].map((contentType) => ({ id: randomUUID(), contentType: contentType as "image/png" | "image/webp", isProfilePicture: false, createdAt: twi.createdAt }));
    const twoImage = { id: randomUUID(), contentType: "image/jpeg" as const, isProfilePicture: false, createdAt: twi.createdAt };
    const one = { ...twi, name: "One Arcade", aliases: ["One"], images: oneImages, appearanceReferenceImageIds: oneImages.map((image) => image.id) };
    const two = { ...twi, id: randomUUID(), name: "Two Arcade", aliases: ["Two"], images: [twoImage], appearanceReferenceImageIds: [twoImage.id] };
    const profiles = [one, two];
    const service = {
      async getAlter(_owner: string, id: string) { const profile = profiles.find((item) => item.id === id); if (!profile) throw new Error("Not found"); return profile; },
      async listAlters(_owner: string, input: { cursor?: string; includeArchived: boolean }) { assert.equal(input.includeArchived, false); return input.cursor ? { data: [two] } : { data: [one], nextCursor: "second-page" }; },
    };
    const result = await prepareFurryScene(service, "test:owner", { scene: "Friends under city lights", alterNames: ["Two", "One", "Two Arcade"] }, "https://example.invalid");
    assert.equal(result.structuredContent.ready, true);
    assert.deepEqual(result.structuredContent.identities.map((identity) => [identity.alterId, identity.referenceImageIds]), [[two.id, [twoImage.id]], [one.id, oneImages.map((image) => image.id)]]);
    assert.deepEqual(result._meta.referenceMedia.map((media) => [media.alterId, media.imageId]), [[two.id, twoImage.id], [one.id, oneImages[0].id], [one.id, oneImages[1].id]]);
    assert.doesNotMatch(JSON.stringify([result.structuredContent, result.content]), /cap=|https:|storageKey/);
    assert.match(result.content[0].text, /preparation only/i);
  } finally {
    if (secret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET; else process.env.MCP_TOKEN_SIGNING_SECRET = secret;
  }
});

test("Furry scene preparation rejects unknown, ambiguous, unavailable, missing, raced, and over-limit references", async () => {
  const image = { id: randomUUID(), contentType: "image/png" as const, isProfilePicture: false, createdAt: twi.createdAt };
  const missing = { ...twi, name: "Missing", aliases: [] };
  const unavailable = { ...twi, id: randomUUID(), name: "Unavailable", aliases: [], appearanceReferenceImageIds: [randomUUID()] };
  const ambiguousOne = { ...twi, id: randomUUID(), name: "Ambiguous One", aliases: ["Shared"], images: [image], appearanceReferenceImageIds: [image.id] };
  const ambiguousTwo = { ...twi, id: randomUUID(), name: "Ambiguous Two", aliases: ["Shared"], images: [{ ...image, id: randomUUID() }], appearanceReferenceImageIds: [randomUUID()] };
  const profiles = [missing, unavailable, ambiguousOne, ambiguousTwo];
  const service = { async getAlter(_owner: string, id: string) { const profile = profiles.find((item) => item.id === id); if (!profile) throw new Error("Not found"); return profile; }, async listAlters() { return { data: profiles }; } };
  await assert.rejects(prepareFurryScene(service, "test:owner", { scene: "Portrait", alterNames: ["Nobody"] }, "https://example.invalid"), /SCENE_PARTICIPANT_UNKNOWN/);
  await assert.rejects(prepareFurryScene(service, "test:owner", { scene: "Portrait", alterNames: ["Shared"] }, "https://example.invalid"), /SCENE_PARTICIPANT_AMBIGUOUS/);
  await assert.rejects(prepareFurryScene(service, "test:owner", { scene: "Portrait", alterNames: ["Missing"] }, "https://example.invalid"), /MISSING_APPEARANCE_REFERENCE/);
  await assert.rejects(prepareFurryScene(service, "test:owner", { scene: "Portrait", alterNames: ["Unavailable"] }, "https://example.invalid"), /selected appearance references are unavailable/);

  const listed = { ...twi, name: "Race", aliases: [], images: [image], appearanceReferenceImageIds: [image.id] };
  const raceService = { async getAlter() { return { ...listed, images: [], appearanceReferenceImageIds: [] }; }, async listAlters() { return { data: [listed] }; } };
  await assert.rejects(prepareFurryScene(raceService, "test:owner", { scene: "Portrait", alterNames: ["Race"] }, "https://example.invalid"), /MISSING_APPEARANCE_REFERENCE/);

  const tooManyImages = Array.from({ length: 13 }, () => ({ id: randomUUID(), contentType: "image/png" as const, isProfilePicture: false, createdAt: twi.createdAt }));
  const tooMany = { ...twi, name: "Too Many", aliases: [], images: tooManyImages, appearanceReferenceImageIds: tooManyImages.map((item) => item.id) };
  const limitService = { async getAlter() { return tooMany; }, async listAlters() { return { data: [tooMany] }; } };
  await assert.rejects(prepareFurryScene(limitService, "test:owner", { scene: "Portrait", alterNames: ["Too Many"] }, "https://example.invalid"), /SCENE_REFERENCE_LIMIT_EXCEEDED/);
});

test("visual fields accept self-description, preserve omission and allow explicit clearing", () => {
  const base = { name: "Hybrid", requestId: randomUUID() };
  assert.equal(alterCreateSchema.parse({ ...base, species: "hare / human hybrid" }).species, "hare / human hybrid");
  const patch = { requestId: randomUUID(), expectedVersion: 1 };
  assert.equal(alterPatchSchema.parse({ ...patch, species: null }).species, null);
  assert.equal(alterPatchSchema.parse({ ...patch, name: "Other" }).species, undefined);
  assert.deepEqual(alterPatchSchema.parse({ ...patch, signatureTraits: [] }).signatureTraits, []);
  assert.equal(alterCreateSchema.safeParse({ ...base, visualDescription: "x".repeat(1001) }).success, false);
});
