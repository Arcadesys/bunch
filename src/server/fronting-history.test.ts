import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { frontingHistoryQuerySchema } from "@/domain/fronting-history";
import { SystemService } from "./system-service";
import { createMcpServer } from "./mcp-server";

test("history rejects unzoned timestamps and unbounded page sizes", () => {
  assert.equal(frontingHistoryQuerySchema.safeParse({ from: "2026-09-05T00:00:00" }).success, false);
  assert.equal(frontingHistoryQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(frontingHistoryQuerySchema.safeParse({ from: "2026-09-05T00:00:00-05:00" }).success, true);
});

test("DIDdy exposes and calls owner-scoped read-only fronting history", async () => {
  const response = { data: [], meta: { recordedOnly: true as const } };
  const service = { listFrontingHistory: async (owner: string, input: unknown) => {
    assert.equal(owner, "test:history");
    assert.deepEqual(input, { limit: 50 }); return response;
  } } as unknown as SystemService;
  const server = createMcpServer("test:history", service);
  const client = new Client({ name: "history-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const descriptor = (await client.listTools()).tools.find(tool => tool.name === "list_fronting_history");
    assert.equal(descriptor?.annotations?.readOnlyHint, true);
    assert.deepEqual((await client.callTool({ name: "list_fronting_history", arguments: {} })).structuredContent, response);
  } finally { await client.close(); await server.close(); }
});

test("history interval overlap, pagination, archived profiles and owner isolation", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const service = new SystemService(pool);
  const owner = `test:${randomUUID()}`, other = `test:${randomUUID()}`;
  const profile = randomUUID(), foreignProfile = randomUUID();
  try {
    for (const id of [owner, other]) await pool.query("insert into app_user (id, google_subject) values ($1,$1)", [id]);
    await pool.query("insert into alter_profile (id,owner_id,name,archived_at) values ($1,$2,'History fixture',now()),($3,$4,'Other owner',null)", [profile,owner,foreignProfile,other]);
    for (const [start,end] of [["2026-09-01", "2026-09-02"], ["2026-09-02", "2026-09-04"], ["2026-09-04", null]]) {
      await pool.query("insert into fronting_session (owner_id,alter_id,started_at,ended_at) values ($1,$2,$3,$4)", [owner,profile,`${start}T00:00:00Z`,end ? `${end}T00:00:00Z` : null]);
    }
    await pool.query("insert into fronting_session (owner_id,alter_id,started_at) values ($1,$2,'2026-09-03')", [other,foreignProfile]);
    const window = await service.listFrontingHistory(owner, { from: "2026-09-02T00:00:00Z", to: "2026-09-04T00:00:00Z" });
    assert.equal(window.data.length, 1);
    assert.equal(window.data[0].startedAt, "2026-09-02T00:00:00.000Z");
    const first = await service.listFrontingHistory(owner, { limit: 1 });
    assert.equal(first.data[0].endedAt, undefined);
    assert.ok(first.meta.nextCursor);
    const second = await service.listFrontingHistory(owner, { limit: 1, before: first.meta.nextCursor });
    assert.equal(second.data[0].id, window.data[0].id);
    const third = await service.listFrontingHistory(owner, { limit: 1, before: second.meta.nextCursor });
    assert.equal(third.meta.nextCursor, undefined);
    assert.equal((await service.listFrontingHistory(owner, { alterId: foreignProfile })).data.length, 0);
    assert.equal((await service.listFrontingHistory(owner, { alterId: profile })).data.length, 3);
    assert.equal((await service.listFrontingHistory(owner, { to: "2026-08-01T00:00:00Z" })).data.length, 0);
    await assert.rejects(service.listFrontingHistory(owner, { from: "2026-09-05T00:00:00Z", to: "2026-09-04T00:00:00Z" }), /end must be after/);
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [[owner,other]]);
    await pool.end();
  }
});
