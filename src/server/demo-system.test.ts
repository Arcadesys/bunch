import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_TOOL_NAMES } from "./demo-mcp-server";
import { getDemoSystem } from "./demo-system";
import { GET } from "@/app/api/demo/system/route";
import { handleMcpRequest } from "./mcp-http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://bunch.example/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
const noPrivateAccess = {
  authorize: async () => { throw new Error("Authentication required"); },
  privateServer: () => { throw new Error("Private server must not be reached"); },
};

test("fictional sample preserves names, relationships, gift authorship, shared relevance, and review semantics", () => {
  const demo = getDemoSystem();
  assert.deepEqual(demo.people.map(p => p.name), ["Fenton", "Benny", "Dot"]);
  assert.match(demo.people[2].description, /kid.*no relation/s);
  assert.match(demo.relationships[0].description, /tease.*love/);
  const task = demo.tasks.find(t => t.id === "thank-you-note")!;
  assert.equal(task.title, "Write a thank-you note for the gift we received.");
  assert.equal(task.handledBy, "benny");
  assert.deepEqual(task.relevantTo, ["fenton", "benny"]);
  assert.equal(task.dueOn, null);
  assert.equal(task.status, "OPEN");
  const reminder = demo.notes.find(n => n.id === "thank-you-reminder")!;
  assert.equal(reminder.author, "fenton");
  assert.deepEqual(reminder.relevantTo, ["benny"]);
  assert.match(reminder.body, /gift we received/);
  assert.match(task.details, /donor, gift, and deadline are unspecified/);
  assert.equal(demo.presence.hostingPersonId, "fenton");
  assert.deepEqual(demo.presence.frontingPersonIds, ["benny", "dot"]);
  assert.equal(demo.history.find(h => h.id === "fronting-fenton")?.endedAt, "2026-09-09T12:30:00Z");
  assert.equal(demo.history.find(h => h.id === "hosting-fenton")?.endedAt, null);
  const records = [...demo.notes, ...demo.tasks, ...demo.decisions];
  for (const item of demo.catchUp.items) assert.ok(records.some(r => r.id === item.recordId));
  for (const note of demo.notes.filter(n => demo.catchUp.items.some(i => i.recordId === n.id))) {
    assert.ok(note.createdAt >= demo.catchUp.windowStart && note.createdAt <= demo.catchUp.windowEnd);
  }
  assert.equal(demo.catchUp.windowStart, demo.history.find(h => h.id === "fronting-benny-previous")?.endedAt);
  assert.equal(demo.catchUp.windowEnd, demo.history.find(h => h.id === demo.catchUp.episodeId)?.startedAt);
  demo.people[0].name = "Changed";
  assert.equal(getDemoSystem().people[0].name, "Fenton", "callers cannot mutate the shared fixture");
});

test("public REST endpoint returns only immutable fiction without a database", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), getDemoSystem());
});

test("anonymous hosted MCP discovers and reads demo in production without private access", async () => {
  // There is intentionally no SYSTEM_DEMO_MODE or localhost condition.
  const stream = await handleMcpRequest(new Request("https://bunch.example/mcp", { headers: { accept: "text/event-stream" } }), noPrivateAccess);
  assert.equal(stream.status, 405);
  assert.equal(stream.headers.has("www-authenticate"), false);
  const init = await handleMcpRequest(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } }), noPrivateAccess);
  assert.equal(init.status, 200);
  assert.match((await init.json()).result.instructions, /Demo system/);
  const listing = await handleMcpRequest(rpc("tools/list"), noPrivateAccess);
  const tools = (await listing.json()).result.tools;
  assert.deepEqual(tools.map((t: {name: string}) => t.name), [...DEMO_TOOL_NAMES, "connect_private_system"]);
  assert.deepEqual(tools[0].securitySchemes, [{ type: "noauth" }]);
  assert.deepEqual(tools.at(-1).securitySchemes, [{ type: "oauth2", scopes: ["system:companion"] }]);
  const result = await handleMcpRequest(rpc("tools/call", { name: "get_demo_system", arguments: {} }), noPrivateAccess);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual((await result.json()).result.structuredContent, getDemoSystem());
});

test("private calls, resources, and every supplied invalid credential remain unauthorized", async () => {
  for (const name of ["connect_private_system", "get_companion_state", "list_alters", "create_todo", "set_system_host"]) {
    const response = await handleMcpRequest(rpc("tools/call", { name, arguments: {} }), noPrivateAccess);
    assert.equal(response.status, 401, name);
    assert.match(response.headers.get("www-authenticate")!, /Bearer/);
  }
  assert.equal((await handleMcpRequest(rpc("resources/read", { uri: "private" }), noPrivateAccess)).status, 401);
  for (const authorization of ["", "Basic abc", "Bearer expired", "Bearer revoked"]) {
    for (const method of ["tools/list", "tools/call"]) {
      const result = await handleMcpRequest(rpc(method, { name: "get_demo_system", arguments: {} }, { authorization }), noPrivateAccess);
      assert.equal(result.status, 401);
      assert.doesNotMatch(await result.text(), /Fenton|Benny|Dot/);
    }
  }
});

test("authenticated routing preserves each verified owner and never falls back on access failures", async () => {
  for (const ownerId of ["auth0:tenant-one", "auth0:tenant-two"]) {
    const dependencies = {
      authorize: async (request: Request) => { assert.equal(request.headers.get("authorization"), "Bearer valid"); return ownerId; },
      privateServer: (verifiedOwner: string) => {
        assert.equal(verifiedOwner, ownerId);
        const server = new McpServer({ name: "private-test", version: "1" });
        server.registerTool("get_companion_state", { inputSchema: {} }, async () => ({ content: [{ type: "text", text: verifiedOwner }] }));
        return server;
      },
    };
    const response = await handleMcpRequest(rpc("tools/call", { name: "get_companion_state", arguments: {} }, { authorization: "Bearer valid" }), dependencies);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.result.content[0].text, ownerId);
    assert.doesNotMatch(JSON.stringify(data), /Fenton|Benny|Dot/);
  }
});
