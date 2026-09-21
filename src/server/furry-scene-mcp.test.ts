import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/server/mcp-server";
import type { SystemService } from "@/server/system-service";

process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch.example";

test("scene preparation exposes external metadata and a zero-cost ChatGPT image handoff", async () => {
  const priorSecret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "furry-scene-mcp-test-secret-with-enough-entropy";
  const now = "2026-09-08T12:00:00.000Z";
  const oneImages = ["image/png", "image/webp"].map((contentType) => ({ id: randomUUID(), contentType: contentType as "image/png" | "image/webp", isProfilePicture: false, createdAt: now }));
  const twoImage = { id: randomUUID(), contentType: "image/jpeg" as const, isProfilePicture: false, createdAt: now };
  const one = { id: randomUUID(), name: "One Arcade", aliases: ["One"], strengths: [], boundaries: [], images: oneImages, imageCount: 2, appearanceReferenceImageIds: oneImages.map((image) => image.id), version: 1, createdAt: now, updatedAt: now, species: "hare", visualDescription: "A violet hare." };
  const two = { ...one, id: randomUUID(), name: "Two Arcade", aliases: ["Two"], images: [twoImage], imageCount: 1, appearanceReferenceImageIds: [twoImage.id] };
  const profiles = [one, two];
  const service = {
    async getAlter(_owner: string, id: string) { const profile = profiles.find((item) => item.id === id); if (!profile) throw new Error("Not found"); return profile; },
    async listAlters(_owner: string, input: { cursor?: string; includeArchived?: boolean }) { return input.cursor ? { data: [two] } : { data: [one], nextCursor: "page-two" }; },
  } as unknown as SystemService;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const server = createMcpServer("test:furry-scene", service, undefined, { listProfiles: async () => [] }, undefined, undefined, undefined, undefined, async ({ imageId }) => {
    if (imageId === twoImage.id) return { bytes: jpeg, contentType: twoImage.contentType };
    if (imageId === oneImages[0].id) return { bytes: png, contentType: oneImages[0].contentType };
    if (imageId === oneImages[1].id) return { bytes: webp, contentType: oneImages[1].contentType };
    throw new Error("Unexpected reference");
  });
  const client = new Client({ name: "furry-scene-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const descriptor = tools.find((tool) => tool.name === "prepare_furry_scene");
    assert.equal(descriptor?.annotations?.readOnlyHint, true);
    assert.equal(descriptor?.annotations?.openWorldHint, false);
    const result = await client.callTool({ name: "prepare_furry_scene", arguments: { scene: "A warm studio portrait", alterNames: ["Two", "One"] } });
    const structured = result.structuredContent as { ready: boolean; identities: Array<{ alterId: string; referenceImageIds: string[] }> };
    const metadata = result._meta as { referenceMedia: Array<{ alterId: string; imageId: string }> };
    assert.equal(structured.ready, true);
    assert.deepEqual(structured.identities.map((identity) => [identity.alterId, identity.referenceImageIds]), [[two.id, [twoImage.id]], [one.id, oneImages.map((image) => image.id)]]);
    assert.deepEqual(metadata.referenceMedia.map((media) => [media.alterId, media.imageId]), [[two.id, twoImage.id], [one.id, oneImages[0].id], [one.id, oneImages[1].id]]);
    assert.doesNotMatch(JSON.stringify([result.structuredContent, result.content]), /cap=|https:|storageKey/);

    const chatDescriptor = tools.find((tool) => tool.name === "prepare_chatgpt_scene");
    assert.equal(chatDescriptor?.annotations?.readOnlyHint, true);
    assert.equal(chatDescriptor?.annotations?.openWorldHint, false);
    const chat = await client.callTool({ name: "prepare_chatgpt_scene", arguments: { scene: "A warm studio portrait", alterNames: ["Two", "One"] } });
    const chatStructured = chat.structuredContent as { bunchGeneration: string; allowanceCharged: boolean; referenceSlots: Array<{ alterId: string; imageId: string }> };
    assert.equal(chatStructured.bunchGeneration, "none");
    assert.equal(chatStructured.allowanceCharged, false);
    assert.deepEqual(chatStructured.referenceSlots.map((slot) => [slot.alterId, slot.imageId]), [[two.id, twoImage.id], [one.id, oneImages[0].id], [one.id, oneImages[1].id]]);
    assert.deepEqual((chat.content as Array<{ type: string }>).map((block) => block.type), ["text", "image", "image", "image"]);
    assert.doesNotMatch(JSON.stringify(chat.structuredContent), /cap=|https:|storageKey/);
  } finally {
    await client.close();
    await server.close();
    if (priorSecret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET; else process.env.MCP_TOKEN_SIGNING_SECRET = priorSecret;
  }
});
