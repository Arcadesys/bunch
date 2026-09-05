import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Pool } from "pg";
import { SystemService } from "./system-service";
import { SystemError } from "./system-error";
import { endFrontingEpisodeSchema, startFrontingEpisodeSchema } from "@/domain/presence";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
const conflict = (error: unknown) => error instanceof SystemError && error.code === "CONFLICT";

test("episode contracts cannot silently claim hosting or expire on a timer", () => {
  assert.equal(startFrontingEpisodeSchema.safeParse({ requestId: randomUUID(), alterId: randomUUID(), kind: "HOSTING" }).success, false);
  assert.equal(startFrontingEpisodeSchema.safeParse({ requestId: randomUUID(), alterId: randomUUID(), durationHours: 3 }).success, false);
  assert.equal(endFrontingEpisodeSchema.safeParse({ requestId: randomUUID(), episodeId: randomUUID() }).success, false);
});

integration("hosting and multiple fronting episodes overlap, close independently, and stay owner scoped", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5 });
  const service = new SystemService(pool);
  const owner = `presence:${randomUUID()}`, other = `presence:${randomUUID()}`;
  try {
    const a = (await service.createAlter(owner, { requestId: randomUUID(), name: "Host fixture" }, "WEB")).data;
    const b = (await service.createAlter(owner, { requestId: randomUUID(), name: "Front fixture" }, "WEB")).data;
    const c = (await service.createAlter(owner, { requestId: randomUUID(), name: "Second front fixture" }, "WEB")).data;
    const foreign = (await service.createAlter(other, { requestId: randomUUID(), name: "Foreign fixture" }, "WEB")).data;
    // Old records are never reclassified, even if the same profile later hosts.
    const legacy = (await service.switchCurrentFront(owner, { requestId: randomUUID(), alterId: a.id, expectedCurrentVersion: null }, "WEB")).data.current;
    assert.deepEqual(JSON.parse(JSON.stringify(await service.getCurrentPresence(owner))), { hosting: null, fronting: [], legacyCurrentFront: legacy });
    const hostInput = { requestId: randomUUID(), alterId: a.id, expectedVersion: null };
    const host = await service.setSystemHost(owner, hostInput, "MCP");
    assert.equal((await service.setSystemHost(owner, hostInput, "MCP")).replayed, true);
    const before = await service.getCurrentPresence(owner);
    assert.equal(before.hosting?.alterId, a.id);
    assert.equal(before.hosting?.origin, "EXPLICIT");
    assert.equal(before.fronting.length, 0, "hosting does not automatically create a fronting episode");
    const startInput = { requestId: randomUUID(), alterId: b.id };
    const first = await service.startFrontingEpisode(owner, startInput, "MCP");
    const second = await service.startFrontingEpisode(owner, { requestId: randomUUID(), alterId: c.id }, "MCP");
    assert.deepEqual((await service.startFrontingEpisode(owner, startInput, "MCP")).data, first.data);
    const alongside = await service.getCurrentPresence(owner);
    assert.deepEqual(alongside.hosting, before.hosting);
    assert.equal(alongside.fronting.length, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(alongside.legacyCurrentFront)), legacy);
    assert.equal((await service.getCurrentPresence(other)).fronting.length, 0);
    await assert.rejects(service.startFrontingEpisode(owner, { requestId: randomUUID(), alterId: foreign.id }, "MCP"));
    await assert.rejects(service.endFrontingEpisode(other, { requestId: randomUUID(), episodeId: first.data.id, expectedVersion: 1 }, "MCP"));
    await assert.rejects(service.endFrontingEpisode(owner, { requestId: randomUUID(), episodeId: before.hosting!.id, expectedVersion: 1 }, "MCP"), /set_system_host/);
    await assert.rejects(service.endFrontingEpisode(owner, { requestId: randomUUID(), episodeId: first.data.id, expectedVersion: 9 }, "MCP"), conflict);
    const endInput = { requestId: randomUUID(), episodeId: first.data.id, expectedVersion: 1 };
    const ended = await service.endFrontingEpisode(owner, endInput, "MCP");
    assert.ok(ended.data.endedAt);
    assert.deepEqual((await service.endFrontingEpisode(owner, endInput, "MCP")).data, ended.data);
    assert.equal((await service.getCurrentPresence(owner)).fronting[0].id, second.data.id);
    assert.deepEqual((await service.getCurrentPresence(owner)).hosting, before.hosting);
    // Host handoff does not terminate a fronting episode that crosses its boundary.
    const changed = await service.setSystemHost(owner, { requestId: randomUUID(), alterId: b.id, expectedVersion: host.data.version }, "WEB");
    const after = await service.getCurrentPresence(owner);
    assert.equal(after.hosting?.alterId, b.id);
    assert.equal(after.fronting[0].id, second.data.id);
    const hostingHistory = await service.listFrontingHistory(owner, { kind: "HOSTING" });
    assert.equal(hostingHistory.data.length, 2);
    assert.equal(hostingHistory.data.find(p => p.id === before.hosting!.id)?.endedAt, after.hosting?.startedAt);
    await service.setSystemHost(owner, { requestId: randomUUID(), alterId: null, expectedVersion: changed.data.version }, "WEB");
    assert.equal((await service.getCurrentPresence(owner)).hosting, null);
    assert.equal((await service.getCurrentPresence(owner)).fronting.length, 1, "episodes do not require a currently recorded host");
    const all = await service.listFrontingHistory(owner, {});
    assert.equal(all.data.length, 5);
    assert.equal(all.data.find(p => p.id === legacy.id)?.kind, "LEGACY_FRONT");
    assert.equal((await service.listFrontingHistory(owner, { kind: "FRONTING", alterId: b.id })).data[0].id, first.data.id);
    assert.equal((await service.listFrontingHistory(owner, { kind: "FRONTING", alterId: foreign.id })).data.length, 0);
    const paged: string[] = [];
    let cursor;
    do {
      const page = await service.listFrontingHistory(owner, { limit: 1, before: cursor });
      paged.push(...page.data.map(p => p.id)); cursor = page.meta.nextCursor;
    } while (cursor);
    assert.deepEqual(paged, all.data.map(p => p.id));
    const events = await pool.query("select count(*)::int as count from activity_event where owner_id=$1 and entity_type='FRONTING_EPISODE'", [owner]);
    assert.equal(events.rows[0].count, 3, "retries and rejected writes do not add events");
    // Database constraints are a second line of protection.
    const dbCode = (code: string) => (e: unknown) => (e as {code: string}).code === code;
    await assert.rejects(pool.query("insert into presence_period(owner_id,alter_id,kind) values ($1,$2,'FRONTING')", [owner,c.id]), dbCode("23505"));
    await assert.rejects(pool.query("insert into presence_period(owner_id,alter_id,kind) values ($1,$2,'FRONTING')", [owner,foreign.id]), dbCode("23503"));
    await assert.rejects(pool.query("insert into presence_period(owner_id,alter_id,kind,started_at,ended_at) values ($1,$2,'FRONTING','2026-09-05','2026-09-04')", [owner,b.id]), dbCode("23514"));
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [[owner,other]]);
    await pool.end();
  }
});

integration("concurrent starts and ends allow one winner and a later independent episode", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
  const service = new SystemService(pool);
  const owner = `presence-race:${randomUUID()}`;
  try {
    const a = (await service.createAlter(owner, { requestId: randomUUID(), name: "Race fixture" }, "WEB")).data;
    const starts = await Promise.allSettled([1,2].map(() => service.startFrontingEpisode(owner, { requestId: randomUUID(), alterId: a.id }, "WEB")));
    assert.equal(starts.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(starts.filter(r => r.status === "rejected" && conflict(r.reason)).length, 1);
    const episode = (await service.getCurrentPresence(owner)).fronting[0];
    const ends = await Promise.allSettled([1,2].map(() => service.endFrontingEpisode(owner, { requestId: randomUUID(), episodeId: episode.id, expectedVersion: 1 }, "WEB")));
    assert.equal(ends.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(ends.filter(r => r.status === "rejected" && conflict(r.reason)).length, 1);
    const next = await service.startFrontingEpisode(owner, { requestId: randomUUID(), alterId: a.id }, "WEB");
    assert.notEqual(next.data.id, episode.id);
    await service.archiveAlter(owner, a.id, { requestId: randomUUID(), expectedVersion: a.version }, "WEB");
    await service.endFrontingEpisode(owner, { requestId: randomUUID(), episodeId: next.data.id, expectedVersion: 1 }, "WEB");
    await assert.rejects(service.startFrontingEpisode(owner, { requestId: randomUUID(), alterId: a.id }, "WEB"));
    assert.equal((await service.listFrontingHistory(owner, { kind: "FRONTING" })).data.length, 2);
  } finally { await pool.query("delete from app_user where id=$1", [owner]); await pool.end(); }
});

integration("migration seeds only explicit current hosts and leaves legacy sessions untouched", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const client = await pool.connect();
  const schema = `migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("begin");
    await client.query(`create schema ${schema}`);
    await client.query(`set local search_path to ${schema}, public`);
    await client.query(`create table app_user(id text primary key);
      create table alter_profile(owner_id text, id uuid, primary key(owner_id,id));
      create table system_host(owner_id text, alter_id uuid, recorded_at timestamptz);
      create table fronting_session(id uuid, owner_id text, alter_id uuid, started_at timestamptz);`);
    const id = randomUUID();
    await client.query("insert into app_user values ('recorded'),('cleared'),('never'); insert into alter_profile values ('recorded','" + id + "')");
    await client.query("insert into system_host values ('recorded',$1,'2026-09-01T12:00:00Z'),('cleared',null,'2026-09-02T12:00:00Z')", [id]);
    await client.query("insert into fronting_session values ($1,'recorded',$1,'2026-08-01T12:00:00Z')", [id]);
    const legacy = await client.query("select * from fronting_session");
    await client.query(await readFile(new URL("../../drizzle/0006_hosting_fronting_periods.sql", import.meta.url), "utf8"));
    const periods = await client.query("select * from presence_period");
    assert.equal(periods.rowCount, 1);
    assert.equal(periods.rows[0].kind, "HOSTING");
    assert.equal(periods.rows[0].origin, "SYSTEM_HOST_SNAPSHOT");
    assert.equal(periods.rows[0].started_at.toISOString(), "2026-09-01T12:00:00.000Z");
    assert.deepEqual((await client.query("select * from fronting_session")).rows, legacy.rows);
    await client.query("update system_host set recorded_at='2026-09-03T12:00:00Z' where owner_id='recorded'");
    assert.equal((await client.query("select count(*)::int as n from presence_period")).rows[0].n, 1, "reaffirming the same host does not split a period");
    await assert.rejects(client.query("insert into presence_period(owner_id,alter_id,kind) values ('recorded',$1,'HOSTING')", [id]), (e: unknown) => (e as {code: string}).code === "23505");
  } finally { await client.query("rollback"); client.release(); await pool.end(); }
});
