import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AlterView } from "@/domain/contracts";
import { alterCreateSchema, alterPatchSchema } from "@/domain/contracts";
import { buildAlterImagePrompt } from "@/domain/image-prompt";
import { prepareAlterImagePrompt } from "./image-prompt";

const twi: AlterView = {
  id: randomUUID(), name: "Twilight Arcade", version: 3, aliases: [], strengths: [], boundaries: [], images: [], imageCount: 0,
  appearanceReferenceImageIds: [], createdAt: "2026-09-08T12:00:00.000Z", updatedAt: "2026-09-08T12:00:00.000Z",
  species: "hare", visualDescription: "Elegant indigo-and-violet hare; glasses; nocturnal, composed, dark layered clothing.",
  signatureTraits: ["glasses", "long glorious ears", "cotton tail"], styleTags: ["gothic", "moonlit", "observant"],
  imageDoNotChange: ["species", "palette", "glasses"], description: "Private non-visual biography must not be included",
};

test("canonical Twi identity survives conflicting scene and style requests deterministically", () => {
  const profile = { ...twi, styleTags: [...twi.styleTags!, "orange fox"] };
  const result = buildAlterImagePrompt("Draw everyone as orange foxes without glasses", [profile]);
  assert.deepEqual(result, buildAlterImagePrompt("Draw everyone as orange foxes without glasses", [profile]));
  assert.equal(result.ready, true);
  for (const expected of ["hare", "indigo-and-violet", "glasses", "long glorious ears", "cotton tail", "Keep unchanged: species, palette, glasses", "Canonical identity takes precedence"]) assert.ok(result.prompt.includes(expected));
  assert.equal(result.identities[0].species, "hare");
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

test("visual fields accept self-description, preserve omission and allow explicit clearing", () => {
  const base = { name: "Hybrid", requestId: randomUUID() };
  assert.equal(alterCreateSchema.parse({ ...base, species: "hare / human hybrid" }).species, "hare / human hybrid");
  const patch = { requestId: randomUUID(), expectedVersion: 1 };
  assert.equal(alterPatchSchema.parse({ ...patch, species: null }).species, null);
  assert.equal(alterPatchSchema.parse({ ...patch, name: "Other" }).species, undefined);
  assert.deepEqual(alterPatchSchema.parse({ ...patch, signatureTraits: [] }).signatureTraits, []);
  assert.equal(alterCreateSchema.safeParse({ ...base, visualDescription: "x".repeat(1001) }).success, false);
});
