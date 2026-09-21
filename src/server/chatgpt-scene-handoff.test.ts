import assert from "node:assert/strict";
import test from "node:test";
import { prepareChatGPTSceneHandoff, type PreparedFurrySceneForChatGPT } from "./chatgpt-scene-handoff";

const one = "11111111-1111-4111-8111-111111111111";
const two = "22222222-2222-4222-8222-222222222222";
const oneImage = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const twoImage = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function prepared(overrides: Partial<PreparedFurrySceneForChatGPT> = {}): PreparedFurrySceneForChatGPT {
  return {
    structuredContent: {
      ready: true,
      status: "READY",
      prompt: "Draw the selected characters.",
      notices: [],
      identities: [
        {
          alterId: one,
          alterName: "Colette",
          profileVersion: 1,
          species: "fox",
          visualDescription: "red fox",
          presentation: "feminine",
          signatureTraits: [],
          styleTags: [],
          imageDoNotChange: [],
          referenceImageIds: [oneImage],
          reliesOnReference: false,
          missingFields: [],
          ready: true,
          preservationInstructions: "Preserve identity.",
        },
        {
          alterId: two,
          alterName: "Lilith",
          profileVersion: 1,
          species: "dragon",
          visualDescription: "purple dragon",
          presentation: "feminine",
          signatureTraits: [],
          styleTags: [],
          imageDoNotChange: [],
          referenceImageIds: [twoImage],
          reliesOnReference: false,
          missingFields: [],
          ready: true,
          preservationInstructions: "Preserve identity.",
        },
      ],
    },
    _meta: {
      referenceMedia: [
        { role: "character_reference", alterId: one, alterName: "Colette", imageId: oneImage, contentType: "image/png", src: "https://private.invalid/capability" },
        { role: "character_reference", alterId: two, alterName: "Lilith", imageId: twoImage, contentType: "image/webp", src: "https://private.invalid/other-capability" },
      ],
    },
    ...overrides,
  };
}

test("returns canonical prompt and ordered image blocks with safe slot metadata", async () => {
  const calls: Array<{ alterId: string; imageId: string }> = [];
  const result = await prepareChatGPTSceneHandoff(prepared(), async (reference) => {
    calls.push(reference);
    return reference.imageId === oneImage ? { bytes: png, contentType: "image/png" } : { bytes: webp, contentType: "image/webp" };
  });

  assert.deepEqual(calls, [{ alterId: one, imageId: oneImage }, { alterId: two, imageId: twoImage }]);
  assert.equal(result.content[0].type, "text");
  assert.match((result.content[0] as { text: string }).text, /Draw the selected characters/);
  const blocks = result.content.slice(1);
  assert.deepEqual(blocks.map((block) => block.type), ["image", "image"]);
  assert.deepEqual(result.structuredContent.referenceSlots, [
    { slot: "reference-1", order: 1, alterId: one, alterName: "Colette", imageId: oneImage },
    { slot: "reference-2", order: 2, alterId: two, alterName: "Lilith", imageId: twoImage },
  ]);
  assert.equal(result.structuredContent.bunchGeneration, "none");
  assert.equal(result.structuredContent.allowanceCharged, false);
  assert.deepEqual((blocks[0] as { _meta: unknown })._meta, result.structuredContent.referenceSlots[0]);
  assert.equal((blocks[0] as { data: string }).data, Buffer.from(png).toString("base64"));
  assert.equal(JSON.stringify(result).includes("capability"), false);
  assert.equal(JSON.stringify(result).includes("storageKey"), false);
});

test("fails closed on reordered or missing associations", async () => {
  const reordered = prepared({ _meta: { referenceMedia: [...prepared()._meta!.referenceMedia!].reverse() } });
  await assert.rejects(() => prepareChatGPTSceneHandoff(reordered, async () => ({ bytes: png, contentType: "image/png" })), /association is invalid/);
  await assert.rejects(() => prepareChatGPTSceneHandoff(prepared({ _meta: { referenceMedia: [] } }), async () => ({ bytes: png, contentType: "image/png" })), /count changed/);
});

test("fails closed on missing, mismatched, and non-image loader data", async () => {
  await assert.rejects(() => prepareChatGPTSceneHandoff(prepared(), async () => { throw new Error("private storage failure"); }), /could not be loaded/);
  await assert.rejects(() => prepareChatGPTSceneHandoff(prepared(), async () => ({ bytes: png, contentType: "image/webp" })), /mismatched/);
  await assert.rejects(() => prepareChatGPTSceneHandoff(prepared(), async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" })), /not image data/);
});

test("rejects an unresolved scene before invoking the byte loader", async () => {
  let called = false;
  const unresolved = prepared({ structuredContent: { ...prepared().structuredContent, ready: false, status: "NEEDS_INFORMATION" } });
  await assert.rejects(() => prepareChatGPTSceneHandoff(unresolved, async () => { called = true; return { bytes: png, contentType: "image/png" }; }), /not ready/);
  assert.equal(called, false);
});
