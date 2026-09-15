/** Synthetic cross-repository acceptance: MCP preparation -> private files -> generator input.
 * Run: node --import tsx scripts/verify-furry-scene-handoff.ts /path/to/furry-image-studio/scripts/diddy-bridge.mjs
 * This checks attachment delivery, not an image model or real character fidelity.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AlterView } from "../src/domain/contracts";
import { requireImageReadCapability } from "../src/server/mcp-authorization";
import { createMcpServer } from "../src/server/mcp-server";
import type { SystemService } from "../src/server/system-service";

type Reference = { alterId: string; alterName: string; imageId: string; contentType: string; path: string };
type GeneratorInput = { prompt: string; characters: Array<{ alterId: string; alterName: string }>; references: Reference[] };

async function main() {
  const bridgePath = process.argv[2];
  if (!bridgePath) throw new Error("Pass the Furry Image Studio diddy-bridge.mjs module path.");
  const { generatePreparedFurryScene } = await import(pathToFileURL(resolve(bridgePath)).href);
  assert.equal(typeof generatePreparedFurryScene, "function");
  process.env.NODE_ENV = "test";
  process.env.MCP_TOKEN_SIGNING_SECRET = randomUUID();
  const owner = "test:furry-scene-handoff";
  const now = new Date().toISOString();
  const profiles: AlterView[] = ["Fixture One", "Fixture Two"].map((name, index) => {
    const images = Array.from({ length: index + 1 }, () => ({ id: randomUUID(), contentType: "image/png" as const, isProfilePicture: false, createdAt: now }));
    return {
      id: randomUUID(), name, aliases: [index === 0 ? "One" : "Two"],
      version: 1, createdAt: now, updatedAt: now, strengths: [], boundaries: [],
      images, imageCount: images.length, appearanceReferenceImageIds: images.map((image) => image.id),
    };
  });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=", "base64");
  const bytes = new Map(profiles.flatMap((profile) => profile.images.map((image) => [image.id, Buffer.concat([png, Buffer.from(`fixture-${image.id}`)])] as const)));
  const downloads: string[] = [];
  const mediaServer = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const claims = requireImageReadCapability(new Request(url));
      const imageId = url.pathname.replace("/api/system/images/inline/", "");
      assert.equal(claims.sub, owner);
      assert.equal(claims.imageId, imageId);
      const image = bytes.get(imageId);
      assert.ok(image);
      downloads.push(imageId);
      response.writeHead(200, { "content-type": "image/png", "cache-control": "private, no-store" });
      response.end(image);
    } catch {
      response.writeHead(403);
      response.end();
    }
  });
  await new Promise<void>((accept) => mediaServer.listen(0, "127.0.0.1", accept));
  const address = mediaServer.address();
  assert.ok(address && typeof address === "object");
  process.env.SYSTEM_PUBLIC_ORIGIN = `http://127.0.0.1:${address.port}`;
  const service = {
    async listAlters(requestOwner: string, input: { cursor?: string; includeArchived: boolean }) {
      assert.equal(requestOwner, owner);
      assert.equal(input.includeArchived, false);
      return input.cursor ? { data: [profiles[1]] } : { data: [profiles[0]], nextCursor: "second-page" };
    },
    async getAlter(requestOwner: string, id: string) {
      assert.equal(requestOwner, owner);
      const profile = profiles.find((candidate) => candidate.id === id);
      assert.ok(profile);
      return profile;
    },
  } as unknown as SystemService;
  const server = createMcpServer(owner, service, undefined, { listProfiles: async () => [] });
  const client = new Client({ name: "furry-scene-handoff-check", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const outputDirectory = await mkdtemp(join(tmpdir(), "furry-scene-check-output-"));
  const outputPath = join(outputDirectory, "synthetic-result.png");
  let localPaths: string[] = [];
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === "prepare_furry_scene"));
    const packet = await client.callTool({ name: "prepare_furry_scene", arguments: { alterNames: ["Two", "One"], scene: "The two fixture characters cooking together." } });
    assert.notEqual(packet.isError, true);
    assert.equal((packet.structuredContent as { ready: boolean }).ready, true);
    assert.doesNotMatch(JSON.stringify({ content: packet.content, structuredContent: packet.structuredContent }), /https?:|cap=|storageKey/);
    const expected = [...profiles].reverse();
    let calls = 0;
    const generated = await generatePreparedFurryScene({ toolResult: packet, generateScene: async (input: GeneratorInput) => {
      calls += 1;
      assert.equal(calls, 1);
      assert.doesNotMatch(JSON.stringify(input), /https?:|cap=|storageKey/);
      assert.deepEqual(input.characters.map((character) => character.alterId), expected.map((profile) => profile.id));
      assert.deepEqual(input.references.map((reference) => [reference.alterId, reference.imageId]), expected.flatMap((profile) => profile.appearanceReferenceImageIds.map((imageId) => [profile.id, imageId])));
      localPaths = input.references.map((reference) => reference.path);
      for (const reference of input.references) {
        assert.deepEqual(await readFile(reference.path), bytes.get(reference.imageId));
        assert.equal((await stat(reference.path)).mode & 0o777, 0o600);
        assert.equal((await stat(dirname(reference.path))).mode & 0o777, 0o700);
      }
      await copyFile(input.references[0].path, outputPath);
      return { outputPath, contentType: "image/png" };
    } });
    assert.equal(calls, 1);
    assert.equal(generated.outputPath, outputPath);
    assert.deepEqual(downloads, expected.flatMap((profile) => profile.appearanceReferenceImageIds));
    for (const path of localPaths) await assert.rejects(stat(path), { code: "ENOENT" });
    assert.ok((await stat(outputPath)).isFile());

    // A failed generator must also remove every temporary reference and suppress its raw error.
    await assert.rejects(generatePreparedFurryScene({ toolResult: packet, generateScene: async (input: GeneratorInput) => {
      localPaths = input.references.map((reference) => reference.path);
      throw new Error("provider failed https://private.invalid/?cap=must-never-escape");
    } }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /private\.invalid|cap=|must-never-escape/);
      return true;
    });
    for (const path of localPaths) await assert.rejects(stat(path), { code: "ENOENT" });
    console.log("PASS: two paginated named profiles and three selected references -> MCP private metadata -> correctly associated generator attachments; capabilities validated; privacy and cleanup verified on success and failure. Synthetic callback only; no image model or private profile was used.");
  } finally {
    await client.close();
    await server.close();
    mediaServer.closeAllConnections();
    await new Promise<void>((accept, reject) => mediaServer.close((error) => error ? reject(error) : accept()));
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error("FAIL: synthetic scene handoff verification failed. No private tool result was logged.");
  process.exitCode = 1;
});
