import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp-server";
import type { SystemService } from "./system-service";

// The MCP server has no default origin, so every test that builds one must say
// where this instance is served from. Pinned rather than defaulted: these
// assertions must not change with whatever origin the shell happens to export.
process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch.example";

test("Working Monkeys presence tools carry explicit kinds, versions, and retry metadata", async () => {
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
      { data: episode, catchUp: null, catchUpStatus: "RETRY_GET_CATCH_UP", meta: { requestId, replayed: true } });
    const end = await client.callTool({ name: "end_fronting_episode", arguments: { requestId, episodeId, expectedVersion: 1 } });
    assert.equal((end.structuredContent as {data: {version: number}}).data.version, 2);
    assert.deepEqual(calls, [["test:presence", { requestId, alterId }, "MCP"], ["test:presence", { requestId, episodeId, expectedVersion: 1 }, "MCP"]]);
  } finally { await client.close(); await server.close(); }
});


test("confirmed arrivals direct ChatGPT to the exact catch-up, while clears and retries do not repeat it", async () => {
  const alterId = "11111111-1111-4111-8111-111111111111";
  const id = "22222222-2222-4222-8222-222222222222";
  const requestId = "33333333-3333-4333-8333-333333333333";
  const startedAt = "2026-09-05T12:00:00.000Z";
  const period = { id, alterId, alterName: "Fixture", kind: "FRONTING", origin: "EXPLICIT", startedAt, version: 1 };
  let replayed = false;
  const service = {
    startFrontingEpisode: async () => ({ data: period, replayed }),
    setSystemHost: async (_owner: string, input: { alterId: string | null }) => ({ data: { id, alterId: input.alterId, alterName: input.alterId ? "Fixture" : null, version: 1, recordedAt: startedAt }, replayed }),
    switchCurrentFront: async () => ({ data: { current: { id, alterId, alterName: "Fixture", startedAt, version: 1 }, previous: null }, replayed }),
  } as unknown as SystemService;
  const server = createMcpServer("test:arrival", service);
  const client = new Client({ name: "arrival-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const start = await client.callTool({ name: "start_fronting_episode", arguments: { requestId, alterId } });
    assert.equal(start.isError, undefined);
    assert.match(JSON.stringify(start.content), new RegExp(`periodId ${id}`));
    assert.match(JSON.stringify(start.content), /Generate the returned conversation catch-up in ChatGPT now/);
    const host = await client.callTool({ name: "set_system_host", arguments: { requestId, alterId, expectedVersion: null } });
    assert.match(JSON.stringify(host.content), /hosting.startedAt equals 2026-09-05T12:00:00.000Z/);
    const cleared = await client.callTool({ name: "set_system_host", arguments: { requestId, alterId: null, expectedVersion: 1 } });
    assert.doesNotMatch(JSON.stringify(cleared.content), /prepare_conversation_catch_up/);
    replayed = true;
    const replay = await client.callTool({ name: "start_fronting_episode", arguments: { requestId, alterId } });
    assert.match(JSON.stringify(replay.content), /do not generate a duplicate summary/);
    assert.doesNotMatch(JSON.stringify(replay.content), /Call prepare_conversation_catch_up now/);
  } finally { await client.close(); await server.close(); }
});
