import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { SystemService } from "./system-service";
import { CatchUpService } from "./catch-up-service";

const integrationTest = process.env.TEST_DATABASE_URL ? test : test.skip;

integrationTest("confirmed switch opens durable owner-scoped catch-up and review leaves source todo unchanged", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
  const service = new SystemService(pool, async () => undefined);
  const catchUp = new CatchUpService(pool);
  const owner = `test:${crypto.randomUUID()}`;
  const otherOwner = `test:${crypto.randomUUID()}`;
  try {
    const profile = await service.createAlter(owner, { requestId: crypto.randomUUID(), name: "Synthetic Robin" }, "WEB");
    const other = await service.createAlter(otherOwner, { requestId: crypto.randomUUID(), name: "Synthetic Finch" }, "WEB");
    const todo = await service.createTodo(owner, { requestId: crypto.randomUUID(), title: "Durable synthetic todo", priority: "HIGH", dueOn: "2026-09-05", status: "OPEN", assigneeAlterIds: [profile.data.id] }, "WEB");
    await service.createNote(owner, { requestId: crypto.randomUUID(), body: "Private synthetic note", alterId: profile.data.id }, "WEB");
    await service.switchCurrentFront(owner, { requestId: crypto.randomUUID(), alterId: profile.data.id, expectedCurrentVersion: null, expectedCurrentSessionId: null }, "WEB");
    await service.switchCurrentFront(otherOwner, { requestId: crypto.randomUUID(), alterId: other.data.id, expectedCurrentVersion: null, expectedCurrentSessionId: null }, "WEB");
    const session = await catchUp.openForCurrentFront(owner);
    assert.ok(session);
    assert.equal(session.alterName, "Synthetic Robin");
    assert.equal(session.firstTime, true);
    assert.ok(session.items.some((item) => item.itemType === "NOTE"));
    const entry = session.items.find((item) => item.itemId === todo.data.id);
    assert.ok(entry);
    assert.equal(entry.dueOn, "2026-09-05");
    const mutation = { requestId: crypto.randomUUID(), expectedVersion: entry.version, state: "RESOLVED" as const };
    const first = await catchUp.setItemState(owner, entry.entryId, mutation, "WEB");
    const replay = await catchUp.setItemState(owner, entry.entryId, mutation, "WEB");
    assert.equal(replay.replayed, true);
    // Receipts are JSON; compare the wire representation (undefined is omitted).
    assert.deepEqual(replay.data, JSON.parse(JSON.stringify(first.data)));
    const reread = await new CatchUpService(pool).openForCurrentFront(owner);
    assert.equal(reread?.id, session.id);
    assert.equal(reread?.items.find((item) => item.itemId === todo.data.id)?.reviewState, "RESOLVED");
    assert.equal((await service.getTodo(owner, todo.data.id)).status, "OPEN");
    const foreign = await catchUp.openForCurrentFront(otherOwner);
    assert.ok(foreign);
    assert.equal(foreign.items.length, 0);
    await assert.rejects(() => catchUp.setItemState(otherOwner, entry.entryId, { ...mutation, requestId: crypto.randomUUID() }, "WEB"));
  } finally {
    await pool.query("delete from todo_assignee where owner_id = any($1::text[])", [[owner, otherOwner]]);
    await pool.query("delete from system_note where owner_id = any($1::text[])", [[owner, otherOwner]]);
    await pool.query("delete from app_user where id = any($1::text[])", [[owner, otherOwner]]);
    await pool.end();
  }
});
