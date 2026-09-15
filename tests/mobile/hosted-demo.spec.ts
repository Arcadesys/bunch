import { test, expect } from "@playwright/test";

// Run against the same built server used by the browser gate. No private DB
// credentials or authentication bypass are needed to demonstrate the API.
test("hosted default sample is public while private tools still challenge", async ({ request }) => {
  const response = await request.get("/api/demo/system");
  expect(response.status()).toBe(200);
  const demo = await response.json();
  expect(demo.label).toBe("Demo system");
  expect(demo.people.map((p: { name: string }) => p.name)).toEqual(["Fenton", "Benny", "Dot"]);
  const call = (name: string, authorization?: string) => request.post("/mcp", {
    headers: { accept: "application/json, text/event-stream", ...(authorization ? { authorization } : {}) },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } },
  });
  const sample = await call("get_demo_system");
  expect(sample.status()).toBe(200);
  expect((await sample.json()).result.structuredContent).toEqual(demo);
  for (const name of ["connect_private_system", "list_alters", "create_todo"]) {
    const privateCall = await call(name);
    expect(privateCall.status()).toBe(401);
    expect(privateCall.headers()["www-authenticate"]).toContain("Bearer");
  }
  expect((await call("get_demo_system", "Bearer invalid")).status()).toBe(401);
});

test("plugin HTTP transport discovers and explores related demo records", async ({ baseURL }) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const client = new Client({ name: "bunch-plugin-demo-check", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", baseURL)));
  try {
    const listed = await client.listTools();
    expect(listed.tools.map(t => t.name)).toContain("list_demo_notes");
    expect(listed.tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
    const read = async (name: string, args = {}) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError).not.toBe(true);
      const data = response.structuredContent as Record<string, unknown>;
      expect(data.label).toBe("Demo system");
      return data;
    };
    const people = await read("list_demo_people");
    expect(people.people).toHaveLength(3);
    const benny = await read("get_demo_person", { personId: "benny" });
    expect(benny.person).toMatchObject({ name: "Benny", dislikes: ["Scheduling"] });
    const tasks = await read("list_demo_tasks", { relevantTo: "benny", status: "OPEN" });
    expect(tasks.tasks).toEqual([expect.objectContaining({ id: "thank-you-note", handledBy: "benny", relevantTo: ["fenton", "benny"] })]);
    const notes = await read("list_demo_notes", { author: "fenton", relevantTo: "benny" });
    expect(notes.notes).toContainEqual(expect.objectContaining({ id: "thank-you-reminder", author: "fenton" }));
    const history = await read("list_demo_history", { personId: "fenton" });
    expect(history.history).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "HOSTING", endedAt: null }), expect.objectContaining({ kind: "FRONTING", endedAt: "2026-09-09T12:30:00Z" })]));
    const presence = await read("get_demo_presence");
    expect(presence.presence).toMatchObject({ hostingPersonId: "fenton", frontingPersonIds: ["benny", "dot"] });
    const catchUp = await read("get_demo_catch_up", { personId: "benny" });
    expect(catchUp.catchUp).toMatchObject({ personId: "benny", items: expect.arrayContaining([expect.objectContaining({ recordId: "thank-you-reminder" })]) });
    expect((await read("get_demo_catch_up", { personId: "dot" })).catchUp).toBeNull();
  } finally { await client.close(); }
});
