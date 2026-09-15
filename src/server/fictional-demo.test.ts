import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fictionalDemoEnabled, getFictionalDemo } from "./fictional-demo";
import { createFictionalDemoServer } from "./fictional-demo-mcp";

test("demo has exactly three fictional people, shared relevance, and independent snapshots", () => {
  const demo = getFictionalDemo();
  assert.equal(demo.systemName, "Demo system");
  assert.deepEqual(demo.people.map(person => person.name), ["Foo", "Bar", "Baz"]);
  assert.notEqual(demo.hosting.name, demo.fronting[0].name);
  assert.deepEqual(demo.tasks[0].relevantTo, ["Foo", "Bar"]);
  const names = demo.people.map(person => person.name);
  for (const note of demo.notes) {
    assert.ok(names.includes(note.from));
    assert.ok(note.relevantTo.every(name => names.includes(name)));
  }
  demo.people[0].name = "Changed";
  assert.equal(getFictionalDemo().people[0].name, "Foo");
});

test("demo requires opt-in and is always disabled in production", () => {
  const env = process.env as Record<string, string | undefined>;
  const originalMode = env.SYSTEM_DEMO_MODE;
  const originalNode = env.NODE_ENV;
  try {
    for (const node of ["development", "production"]) {
      env.NODE_ENV = node;
      for (const mode of ["true", "false", undefined]) {
        if (mode === undefined) delete env.SYSTEM_DEMO_MODE;
        else env.SYSTEM_DEMO_MODE = mode;
        assert.equal(fictionalDemoEnabled(), node === "development" && mode === "true");
      }
    }
  } finally {
    for (const [key, value] of Object.entries({ SYSTEM_DEMO_MODE: originalMode, NODE_ENV: originalNode })) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
});

test("MCP exposes fictional reads only and returns the matching default system", async () => {
  const server = createFictionalDemoServer();
  const client = new Client({ name: "demo-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 5);
    assert.ok(tools.every(tool => tool.annotations?.readOnlyHint === true));
    const result = await client.callTool({ name: "get_demo_system", arguments: {} });
    const content = result.content as Array<{ type: string; text: string }>;
    assert.deepEqual(JSON.parse(content[0].text), getFictionalDemo());
    const unknown = await client.callTool({ name: "create_alter", arguments: {} });
    assert.equal(unknown.isError, true);
  } finally { await client.close(); await server.close(); }
});

test("HTTP demo rejects disabled, production, non-loopback, and cross-origin requests", async () => {
  const { POST } = await import("../app/demo/mcp/route");
  const env = process.env as Record<string, string | undefined>;
  const original = { SYSTEM_DEMO_MODE: env.SYSTEM_DEMO_MODE, NODE_ENV: env.NODE_ENV };
  try {
    env.NODE_ENV = "development";
    env.SYSTEM_DEMO_MODE = "false";
    assert.equal((await POST(new Request("http://127.0.0.1:3100/demo/mcp", { method: "POST" }))).status, 404);
    env.SYSTEM_DEMO_MODE = "true";
    env.NODE_ENV = "production";
    assert.equal((await POST(new Request("http://127.0.0.1:3100/demo/mcp", { method: "POST" }))).status, 404);
    env.NODE_ENV = "development";
    assert.equal((await POST(new Request("https://example.com/demo/mcp", { method: "POST" }))).status, 403);
    assert.equal((await POST(new Request("http://127.0.0.1:3100/demo/mcp", { method: "POST", headers: { origin: "https://example.com" } }))).status, 403);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete env[key]; else env[key] = value;
    }
  }
});
