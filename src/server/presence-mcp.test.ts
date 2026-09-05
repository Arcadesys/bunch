import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp-server";
import type { SystemService } from "./system-service";

test("DIDdy presence tools carry explicit kinds, versions, and retry metadata", async () => {
  const alterId = "11111111-1111-4111-8111-111111111111";
  const episodeId = "22222222-2222-4222-8222-222222222222";
  const requestId = "33333333-3333-4333-8333-333333333333";
  const episode = { id: episodeId, alterId, alterName: "Synthetic front", kind: "FRONTING", origin: "EXPLICIT", startedAt: "2026-09-05T12:00:00.000Z", version: 1 };
  const calls: unknown[] = [];
  const service = {
    getCurrentPresence: async (owner: string) => { assert.equal(owner, "test:presence"); return { hosting: null, fronting: [episode], legacyCurrentFront: null }; },
    startFrontingEpisode: async (owner: string, input: unknown, source: string) => { calls.push([owner,input,source]); return { data: episode, replayed: true }; },
    endFrontingEpisode: async (owner: string, input: unknown, source: string) => { calls.push([owner,input,source]); return { data: { ...episode, endedAt: "2026-09-05T14:00:00.000Z", version: 2 }, replayed: false }; },
  } as unknown as SystemService;
  const server = createMcpServer("test:presence", service);
  const client = new Client({ name: "presence-test", version: "1" });
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const tools = new Map((await client.listTools()).tools.map(tool => [tool.name,tool]));
    assert.equal(tools.get("get_current_presence")?.annotations?.readOnlyHint, true);
    for (const name of ["start_fronting_episode", "end_fronting_episode"]) {
      assert.equal(tools.get(name)?.annotations?.readOnlyHint, false);
      assert.equal(tools.get(name)?.annotations?.idempotentHint, true);
    }
    assert.deepEqual((await client.callTool({ name: "get_current_presence", arguments: {} })).structuredContent,
      { data: { hosting: null, fronting: [episode], legacyCurrentFront: null }, meta: {} });
    assert.deepEqual((await client.callTool({ name: "start_fronting_episode", arguments: { requestId, alterId } })).structuredContent,
      { data: episode, meta: { requestId, replayed: true } });
    const end = await client.callTool({ name: "end_fronting_episode", arguments: { requestId, episodeId, expectedVersion: 1 } });
    assert.equal((end.structuredContent as {data: {version: number}}).data.version, 2);
    assert.deepEqual(calls, [["test:presence", { requestId, alterId }, "MCP"], ["test:presence", { requestId, episodeId, expectedVersion: 1 }, "MCP"]]);
  } finally { await client.close(); await server.close(); }
});
