import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp-server";
import { SystemService } from "./system-service";
import { CatchUpService } from "./catch-up-service";
import { conversationCatchUpHandoffSchema } from "@/domain/catch-up";
import { presencePeriodResponseSchema } from "@/domain/presence";

// Deterministic protocol scenarios, not a simulation of ChatGPT history access.
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("@eval arrival-to-conversation handoff through real MCP and PostgreSQL", async (t) => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const service = new SystemService(pool);
  const owner = `arrival-eval:${randomUUID()}`;
  const foreignOwner = `arrival-eval:${randomUUID()}`;
  const server = createMcpServer(owner, service, new CatchUpService(pool));
  const client = new Client({ name: "arrival-eval", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result.content));
    return result;
  }
  try {
    const alter = (await service.createAlter(owner, { requestId: randomUUID(), name: "Synthetic arrival" }, "WEB")).data;
    const newcomer = (await service.createAlter(owner, { requestId: randomUUID(), name: "Synthetic first arrival" }, "WEB")).data;
    const foreign = (await service.createAlter(foreignOwner, { requestId: randomUUID(), name: "Synthetic foreign" }, "WEB")).data;
    await pool.query(`insert into presence_period (owner_id,alter_id,kind,started_at,ended_at)
      values ($1,$2,'HOSTING','2026-08-01T00:00:00Z','2026-08-03T00:00:00Z'),
      ($1,$2,'FRONTING','2026-08-01T00:00:00Z','2026-08-02T00:00:00Z')`, [owner, alter.id]);
    const host = await call("set_system_host", { requestId: randomUUID(), alterId: alter.id, expectedVersion: null });
    const hosting = (await service.getCurrentPresence(owner)).hosting!;
    const startArgs = { requestId: randomUUID(), alterId: alter.id };
    const start = await call("start_fronting_episode", startArgs);
    const period = presencePeriodResponseSchema.parse(start.structuredContent).data;

    await t.test("returning front alongside hosting uses its own prior departure and exact arrival", async () => {
      assert.match(JSON.stringify(start.content), new RegExp(`periodId ${period.id}`));
      const handoff = conversationCatchUpHandoffSchema.parse((await call("prepare_conversation_catch_up", { alterId: alter.id, periodId: period.id, timeZone: "America/Chicago" })).structuredContent);
      assert.equal(handoff.status, "READY");
      assert.equal(handoff.source?.kind, "FRONTING");
      assert.equal(handoff.window?.startAt, "2026-08-02T00:00:00.000Z");
      assert.equal(handoff.window?.endAt, period.startedAt);
      assert.equal(handoff.elapsedSeconds, (Date.parse(period.startedAt) - Date.parse("2026-08-02T00:00:00Z")) / 1000);
      assert.equal((await service.getCurrentPresence(owner)).hosting?.id, hosting.id);
      assert.match(handoff.instructions.join(" "), /Generate the catch-up now in ChatGPT/);
    });
    await t.test("hosting summary uses hosting history and does not borrow the fronting departure", async () => {
      assert.match(JSON.stringify(host.content), /hosting.startedAt equals/);
      const handoff = conversationCatchUpHandoffSchema.parse((await call("prepare_conversation_catch_up", { alterId: alter.id, periodId: hosting.id, timeZone: "UTC" })).structuredContent);
      assert.equal(handoff.source?.kind, "HOSTING");
      assert.equal(handoff.window?.startAt, "2026-08-03T00:00:00.000Z");
      assert.equal(handoff.window?.endAt, hosting.startedAt);
    });
    await t.test("retry and later episode end do not create another arrival or move its cutoff", async () => {
      const replay = await call("start_fronting_episode", startArgs);
      assert.equal(presencePeriodResponseSchema.parse(replay.structuredContent).data.id, period.id);
      assert.match(JSON.stringify(replay.content), /do not generate a duplicate summary/);
      await call("end_fronting_episode", { requestId: randomUUID(), episodeId: period.id, expectedVersion: period.version });
      const handoff = conversationCatchUpHandoffSchema.parse((await call("prepare_conversation_catch_up", { alterId: alter.id, periodId: period.id, timeZone: "UTC" })).structuredContent);
      assert.equal(handoff.window?.endAt, period.startedAt);
      assert.equal(handoff.window?.startAt, "2026-08-02T00:00:00.000Z");
    });
    await t.test("first arrival asks for dates without inventing duration or history", async () => {
      const first = presencePeriodResponseSchema.parse((await call("start_fronting_episode", { requestId: randomUUID(), alterId: newcomer.id })).structuredContent).data;
      const handoff = conversationCatchUpHandoffSchema.parse((await call("prepare_conversation_catch_up", { alterId: newcomer.id, periodId: first.id, timeZone: "UTC" })).structuredContent);
      assert.equal(handoff.status, "NEEDS_DATES");
      assert.equal(handoff.elapsedSeconds, undefined);
      assert.equal(handoff.window, undefined);
    });
    await t.test("unavailable host history is disclosed and handoffs do not persist summaries", async () => {
      const handoff = conversationCatchUpHandoffSchema.parse((await call("prepare_conversation_catch_up", { alterId: alter.id, periodId: period.id, timeZone: "UTC" })).structuredContent);
      assert.equal(handoff.historyAccess, "HOST_REQUIRED");
      assert.match(handoff.instructions.join(" "), /cannot retrieve other conversations/);
      assert.match(handoff.instructions.join(" "), /Never persist raw transcripts/);
      const saved = await pool.query("select count(*)::int as n from catch_up_session where owner_id=$1", [owner]);
      assert.equal(saved.rows[0].n, 0);
      const denied = await client.callTool({ name: "prepare_conversation_catch_up", arguments: { alterId: foreign.id, timeZone: "UTC" } });
      assert.equal(denied.isError, true);
    });
  } finally {
    await client.close();
    await server.close();
    await pool.query("delete from app_user where id=any($1::text[])", [[owner, foreignOwner]]);
    await pool.end();
  }
});
