import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { SystemService } from "./system-service";
import { SystemError } from "./system-error";
import { setSystemHostSchema } from "../domain/host";

const integrationTest = process.env.TEST_DATABASE_URL ? test : test.skip;
const requestId = () => crypto.randomUUID();

test("host contract requires an explicit role and a version without accepting fronting fields", () => {
  assert.equal(setSystemHostSchema.safeParse({ requestId: requestId(), alterId: null }).success, false);
  assert.equal(setSystemHostSchema.safeParse({ requestId: requestId(), alterId: null, expectedVersion: 0 }).success, false);
  assert.equal(setSystemHostSchema.safeParse({ requestId: requestId(), alterId: null, expectedVersion: null, switchedAt: new Date().toISOString() }).success, false);
});

integrationTest("host is independent, owner-scoped, audited, retry-safe, and protected from stale writes", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
  const service = new SystemService(pool, async () => undefined);
  const owner = `host-test:${requestId()}`;
  const otherOwner = `host-test:${requestId()}`;
  try {
    const a = (await service.createAlter(owner, { requestId: requestId(), name: "Synthetic A" }, "WEB")).data;
    const b = (await service.createAlter(owner, { requestId: requestId(), name: "Synthetic B" }, "WEB")).data;
    const foreign = (await service.createAlter(otherOwner, { requestId: requestId(), name: "Synthetic foreign" }, "WEB")).data;
    const front = (await service.switchCurrentFront(owner, { requestId: requestId(), alterId: b.id, expectedCurrentVersion: null }, "WEB")).data.current;
    assert.equal(await service.getSystemHost(owner), null, "fronting must not imply a host");
    const input = { requestId: requestId(), alterId: a.id, expectedVersion: null };
    const first = await service.setSystemHost(owner, input, "MCP");
    assert.equal(first.data.alterId, a.id);
    assert.deepEqual(JSON.parse(JSON.stringify(await service.getCurrentFront(owner))), front);
    assert.equal(await service.getSystemHost(otherOwner), null);
    const retry = await service.setSystemHost(owner, input, "MCP");
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.data, first.data);
    const conflict = (e: unknown) => e instanceof SystemError && e.code === "CONFLICT";
    await assert.rejects(service.setSystemHost(owner, { ...input, requestId: requestId() }, "MCP"), conflict);
    await assert.rejects(service.setSystemHost(owner, { requestId: requestId(), alterId: foreign.id, expectedVersion: 1 }, "MCP"));
    const preview = await service.previewEraseAlter(owner, a.id);
    assert.equal(preview.canErase, false);
    assert.equal(preview.blockers.host, 1);
    const races = await Promise.allSettled([a.id, b.id].map(alterId => service.setSystemHost(owner, { requestId: requestId(), alterId, expectedVersion: 1 }, "MCP")));
    assert.equal(races.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(races.filter(r => r.status === "rejected" && conflict(r.reason)).length, 1);
    const hostBeforeFrontSwitch = await service.getSystemHost(owner);
    await service.switchCurrentFront(owner, { requestId: requestId(), alterId: a.id, expectedCurrentVersion: front.version, expectedCurrentSessionId: front.id }, "WEB");
    assert.deepEqual(await service.getSystemHost(owner), hostBeforeFrontSwitch);
    const cleared = await service.setSystemHost(owner, { requestId: requestId(), alterId: null, expectedVersion: 2 }, "MCP");
    assert.equal(cleared.data.alterId, null);
    assert.equal(cleared.data.version, 3);
    await assert.rejects(service.setSystemHost(owner, { requestId: requestId(), alterId: b.id, expectedVersion: null }, "MCP"), conflict);
    await service.archiveAlter(owner, b.id, { requestId: requestId(), expectedVersion: b.version }, "WEB");
    await assert.rejects(service.setSystemHost(owner, { requestId: requestId(), alterId: b.id, expectedVersion: 3 }, "MCP"));
    const events = await pool.query("select action,from_status,to_status from activity_event where owner_id=$1 and entity_type='HOST' order by created_at", [owner]);
    assert.equal(events.rowCount, 3, "retries and rejected changes leave no extra events");
    assert.equal(events.rows[0].to_status, a.id);
    assert.equal(events.rows[2].action, "CLEARED");
    assert.equal(events.rows[2].to_status, null);
    await assert.rejects(pool.query("update system_host set alter_id=$2 where owner_id=$1", [owner, foreign.id]), (e: unknown) => (e as {code?: string}).code === "23503");
  } finally {
    await pool.query("delete from system_host where owner_id=any($1::text[])", [[owner, otherOwner]]);
    await pool.query("delete from app_user where id=any($1::text[])", [[owner, otherOwner]]);
    await pool.end();
  }
});
