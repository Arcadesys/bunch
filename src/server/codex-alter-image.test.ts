import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { prepareCodexAlterImage } from "./codex-alter-image";
import type { AlterView } from "@/domain/contracts";
import type { ProfileReader } from "./image-prompt";

function profile(name: string): AlterView {
  const images = [0, 1, 2].map((index) => ({ id: randomUUID(), contentType: "image/png" as const, isProfilePicture: index === 0, createdAt: "2026-10-07T12:00:00Z" }));
  return {
    id: randomUUID(), name, aliases: [name.split(" ")[0]], strengths: [], boundaries: [],
    images, imageCount: 3, appearanceReferenceImageIds: [images[2].id, images[1].id],
    signatureTraits: [], styleTags: [], imageDoNotChange: [], version: 1,
    createdAt: "2026-10-07T12:00:00Z", updatedAt: "2026-10-07T12:00:00Z",
  };
}

function reader(profiles: AlterView[]): ProfileReader {
  return {
    async listAlters(owner, input) {
      assert.equal(owner, "owner");
      return input.cursor ? {data: profiles.slice(1)} : {data: profiles.slice(0, 1), nextCursor: "page-two"};
    },
    async getAlter(owner, id) {
      assert.equal(owner, "owner");
      const found = profiles.find(item => item.id === id);
      assert.ok(found);
      return found;
    },
  };
}

test("Codex gets exact ordered session-only routes without profile-picture substitution or signing", async () => {
  const melody = profile("Melody Arcade"), lucy = profile("Lucy Arcade");
  const secret = process.env.MCP_TOKEN_SIGNING_SECRET;
  delete process.env.MCP_TOKEN_SIGNING_SECRET;
  try {
    const result = await prepareCodexAlterImage(reader([melody, lucy]), "owner", {scene: "Working on an AI project", alterNames: ["Lucy", "Melody Arcade", "Lucy Arcade"]}, "https://bunch.example");
    assert.equal(result.structuredContent.status, "REFERENCE_DOWNLOAD_REQUIRED");
    assert.deepEqual(result.structuredContent.references.map(ref => ref.alterName), [lucy.name, lucy.name, melody.name, melody.name]);
    assert.deepEqual(result.structuredContent.references.map(ref => ref.imageId), [...lucy.appearanceReferenceImageIds, ...melody.appearanceReferenceImageIds]);
    for (const ref of result.structuredContent.references) {
      assert.equal(ref.galleryUrl, "https://bunch.example/gallery?id=" + ref.alterId);
      assert.equal(ref.downloadUrl, "https://bunch.example/api/system/gallery-images/" + ref.imageId);
    }
    assert.equal(result.structuredContent.providerCalled, false);
    assert.equal(result.structuredContent.allowanceCharged, false);
    assert.equal(result.structuredContent.saved, false);
    assert.doesNotMatch(JSON.stringify(result), /cap=|storageKey|data:image/);
    assert.match(result.content[0].text, /No reference has been transferred/);
  } finally {
    if (secret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = secret;
  }
});

test("Codex rejects unknown, ambiguous, missing and stale selected references", async () => {
  const melody = profile("Melody Arcade");
  const input = {scene: "AI project", alterNames: ["Melody"]};
  const prepare = (profiles: AlterView[], names = input.alterNames) => prepareCodexAlterImage(reader(profiles), "owner", {...input, alterNames: names}, "https://bunch.example");
  await assert.rejects(() => prepare([melody], ["Unknown"]), /SCENE_PARTICIPANT_UNKNOWN/);
  await assert.rejects(() => prepare([melody, profile("Melody Other")]), /SCENE_PARTICIPANT_AMBIGUOUS/);
  await assert.rejects(() => prepare([{...melody, appearanceReferenceImageIds: []}]), /MISSING_APPEARANCE_REFERENCE/);
  await assert.rejects(() => prepare([{...melody, images: []}]), /selected appearance references are unavailable/);
});
