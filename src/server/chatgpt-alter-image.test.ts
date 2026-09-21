import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { chatgptAlterImageInputSchema } from "@/domain/chatgpt-alter-image";
import { prepareChatgptAlterImage } from "@/server/chatgpt-alter-image";
import type { ProfileReader } from "@/server/image-prompt";

process.env.MCP_TOKEN_SIGNING_SECRET = "chatgpt-alter-image-test-secret-with-enough-entropy";

const now = "2026-09-20T12:00:00.000Z";
const image = (contentType: "image/png" | "image/jpeg" = "image/png") => ({ id: randomUUID(), contentType, isProfilePicture: false, createdAt: now });
const firstImage = image();
const secondImage = image("image/jpeg");
const first = {
  id: randomUUID(), name: "First Arcade", aliases: ["First"], strengths: [], boundaries: [],
  images: [firstImage], imageCount: 1, appearanceReferenceImageIds: [firstImage.id], version: 1,
  createdAt: now, updatedAt: now, species: "hare", visualDescription: "A blue hare.",
};
const second = {
  id: randomUUID(), name: "Second Arcade", aliases: ["Second"], strengths: [], boundaries: [],
  images: [secondImage], imageCount: 1, appearanceReferenceImageIds: [secondImage.id], version: 1,
  createdAt: now, updatedAt: now, species: "fox", visualDescription: "A copper fox.",
};

function serviceFor(profiles: unknown[]) {
  return {
    async getAlter(_owner: string, id: string) {
      const profile = profiles.find((item) => (item as { id: string }).id === id);
      if (!profile) throw new Error("Not found");
      return profile;
    },
    async listAlters(_owner: string, input: { cursor?: string }) {
      return input.cursor ? { data: [] } : { data: profiles, nextCursor: undefined };
    },
  } as ProfileReader;
}

const validInput = {
  scene: "Playing piano in a sunlit room",
  alterNames: ["Second", "First Arcade"],
  sceneImage: { download_url: "https://files.example/scene.png", file_id: "file-scene", mime_type: "image/png", file_name: "piano.png" },
};

test("schema accepts references-only and validates an optional scene/style file", () => {
  const parsed = chatgptAlterImageInputSchema.parse(validInput);
  assert.deepEqual(parsed.sceneImage, validInput.sceneImage);
  const referencesOnly = chatgptAlterImageInputSchema.parse({ scene: validInput.scene, alterNames: validInput.alterNames });
  assert.equal(referencesOnly.sceneImage, undefined);
  assert.throws(() => chatgptAlterImageInputSchema.parse({ ...validInput, sceneImage: { ...validInput.sceneImage, mime_type: "image/gif" } }), /Invalid option/);
  assert.deepEqual(chatgptAlterImageInputSchema.parse({ ...validInput, sceneImage: { download_url: validInput.sceneImage.download_url, file_id: validInput.sceneImage.file_id } }).sceneImage, { download_url: validInput.sceneImage.download_url, file_id: validInput.sceneImage.file_id });
});

test("references-only handoff preserves exact names and reference order with zero Bunch cost", async () => {
  const result = await prepareChatgptAlterImage(serviceFor([first, second]), "owner", { scene: validInput.scene, alterNames: validInput.alterNames }, "https://bunch.example");
  assert.deepEqual(result.structuredContent.identities.map((identity) => identity.alterName), [second.name, first.name]);
  assert.equal(result.structuredContent.bunchGeneration, "none");
  assert.equal(result.structuredContent.nativeJobCreated, false);
  assert.equal(result.structuredContent.providerCalled, false);
  assert.equal(result.structuredContent.allowanceCharged, false);
  assert.equal(result.structuredContent.saved, false);
  assert.equal(result._meta.sceneImage, undefined);
  assert.equal(result._meta.referenceMedia.length, 2);
  assert.match(result._meta.referenceMedia[0].src, /cap=/);
  assert.match(result._meta.referenceMedia[1].src, /cap=/);
});

test("optional scene/style image stays in private metadata alongside ordered references", async () => {
  const result = await prepareChatgptAlterImage(serviceFor([first, second]), "owner", validInput, "https://bunch.example");
  assert.equal(result.structuredContent.ready, true);
  assert.deepEqual(result.structuredContent.identities.map((identity) => identity.alterName), [second.name, first.name]);
  assert.equal(result.structuredContent.referenceCount, 2);
  assert.equal(result.structuredContent.allowanceCharged, false);
  assert.equal(result.structuredContent.saved, false);
  assert.equal(result._meta.sceneImage?.file_id, "file-scene");
  assert.equal(result._meta.referenceMedia.length, 2);
  assert.match(result._meta.referenceMedia[0].src, /cap=/);
  assert.doesNotMatch(JSON.stringify({ content: result.content, structuredContent: result.structuredContent }), /cap=|https:\/\/bunch\.example|storageKey/);
  assert.doesNotMatch(JSON.stringify(result), /https:\/\/files\.example/);
});

test("preserves unknown, ambiguous, and missing-reference validation", async () => {
  await assert.rejects(() => prepareChatgptAlterImage(serviceFor([first]), "owner", { ...validInput, alterNames: ["Nobody"] }, "https://bunch.example"), /SCENE_PARTICIPANT_UNKNOWN/);
  const ambiguous = { ...second, id: randomUUID(), name: "First Arcade", aliases: [] };
  await assert.rejects(() => prepareChatgptAlterImage(serviceFor([first, ambiguous]), "owner", { ...validInput, alterNames: ["First Arcade"] }, "https://bunch.example"), /SCENE_PARTICIPANT_AMBIGUOUS/);
  const noReference = { ...first, appearanceReferenceImageIds: [] };
  await assert.rejects(() => prepareChatgptAlterImage(serviceFor([noReference]), "owner", { ...validInput, alterNames: ["First"] }, "https://bunch.example"), /MISSING_APPEARANCE_REFERENCE/);
});
