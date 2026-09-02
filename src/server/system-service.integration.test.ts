import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SystemError } from "@/server/system-error";
import { SystemService } from "@/server/system-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("alter and todo contracts enforce lifecycle, ownership, idempotency, concurrency, and erasure", async () => {
  process.env.ERASURE_TOKEN_SIGNING_SECRET = "integration-test-secret-with-enough-entropy";
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const removedKeys: string[] = [];
  const service = new SystemService(pool, async (keys) => { removedKeys.push(...keys); });
  const ownerA = `test:${randomUUID()}`;
  const ownerB = `test:${randomUUID()}`;
  const requestId = () => randomUUID();

  try {
    const sensitiveText = `private-${randomUUID()}`;
    const createRequest = requestId();
    const created = await service.createAlter(ownerA, { requestId: createRequest, name: "Aster", aliases: ["Front", "front"], description: sensitiveText, strengths: ["Planning"] }, "MCP");
    assert.equal(created.replayed, false);
    assert.deepEqual(created.data.aliases, ["front"]);

    const replay = await service.createAlter(ownerA, { requestId: createRequest, name: "Ignored retry" }, "MCP");
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.data, created.data);
    const count = await pool.query("select count(*) from alter_profile where owner_id = $1", [ownerA]);
    assert.equal(Number(count.rows[0].count), 1);

    const second = await service.createAlter(ownerA, { requestId: requestId(), name: "Beacon" }, "WEB");
    const foreign = await service.createAlter(ownerB, { requestId: requestId(), name: "Other owner" }, "MCP");
    await assert.rejects(() => service.getAlter(ownerA, foreign.data.id), (error) => error instanceof SystemError && error.code === "NOT_FOUND");
    assert.equal((await service.listAlters(ownerA, { search: "front" })).data[0].id, created.data.id);

    const updated = await service.updateAlter(ownerA, created.data.id, { requestId: requestId(), expectedVersion: 1, pronouns: "they/them" }, "MCP");
    assert.equal(updated.data.version, 2);
    await assert.rejects(() => service.updateAlter(ownerA, created.data.id, { requestId: requestId(), expectedVersion: 1, description: "stale overwrite" }, "MCP"), (error) => error instanceof SystemError && error.code === "CONFLICT" && error.details?.currentVersion === 2);
    assert.equal((await service.getAlter(ownerA, created.data.id)).description, sensitiveText);

    const archivedAlter = await service.archiveAlter(ownerA, created.data.id, { requestId: requestId(), expectedVersion: 2 }, "WEB");
    await assert.rejects(() => service.getAlter(ownerA, created.data.id), (error) => error instanceof SystemError && error.code === "NOT_FOUND");
    const restoredAlter = await service.restoreAlter(ownerA, created.data.id, { requestId: requestId(), expectedVersion: archivedAlter.data.version }, "WEB");
    assert.equal(restoredAlter.data.version, 4);

    assert.equal(await service.getCurrentFront(ownerA), null);
    const firstFrontRequest = requestId();
    const firstFront = await service.switchCurrentFront(ownerA, { requestId: firstFrontRequest, alterId: created.data.id, expectedCurrentVersion: null }, "MCP");
    assert.equal(firstFront.data.current.alterName, "Aster");
    assert.equal(firstFront.data.previous, null);
    const frontReplay = await service.switchCurrentFront(ownerA, { requestId: firstFrontRequest, alterId: created.data.id, expectedCurrentVersion: null }, "MCP");
    assert.equal(frontReplay.replayed, true);
    assert.deepEqual(frontReplay.data, firstFront.data);
    await assert.rejects(() => service.switchCurrentFront(ownerA, { requestId: requestId(), alterId: second.data.id, expectedCurrentVersion: null }, "MCP"), (error) => error instanceof SystemError && error.code === "CONFLICT" && error.details?.currentVersion === 1);
    await assert.rejects(() => service.switchCurrentFront(ownerB, { requestId: requestId(), alterId: second.data.id, expectedCurrentVersion: null }, "MCP"), (error) => error instanceof SystemError && error.code === "NOT_FOUND");
    const switched = await service.switchCurrentFront(ownerA, { requestId: requestId(), alterId: second.data.id, expectedCurrentVersion: firstFront.data.current.version }, "WEB");
    assert.equal(switched.data.current.alterName, "Beacon");
    assert.equal(switched.data.previous?.alterName, "Aster");
    assert.ok(switched.data.previous?.endedAt);
    assert.equal((await service.getCurrentFront(ownerA))?.alterId, second.data.id);
    const frontCounts = await pool.query("select count(*) as total, count(*) filter (where ended_at is null) as current from fronting_session where owner_id = $1", [ownerA]);
    assert.deepEqual({ total: Number(frontCounts.rows[0].total), current: Number(frontCounts.rows[0].current) }, { total: 2, current: 1 });

    const noteRequest = requestId();
    const note = await service.createNote(ownerA, { requestId: noteRequest, body: "Remember this exactly <3", alterId: second.data.id, actorAlterId: created.data.id }, "MCP");
    assert.equal(note.replayed, false);
    assert.equal(note.data.alterName, "Beacon");
    assert.equal(note.data.actorAlterName, "Aster");
    const noteReplay = await service.createNote(ownerA, { requestId: noteRequest, body: "Ignored retry" }, "MCP");
    assert.equal(noteReplay.replayed, true);
    assert.deepEqual(noteReplay.data, note.data);
    assert.equal((await service.listNotes(ownerA, { alterId: second.data.id, actorAlterId: created.data.id })).data[0].id, note.data.id);
    await assert.rejects(() => service.createNote(ownerA, { requestId: requestId(), body: "Cross-owner actor", actorAlterId: foreign.data.id }, "MCP"), (error) => error instanceof SystemError && error.code === "VALIDATION_ERROR");

    const zero = await service.createTodo(ownerA, { requestId: requestId(), title: "System-wide" }, "MCP");
    const one = await service.createTodo(ownerA, { requestId: requestId(), title: "One alter", status: "OPEN", assigneeAlterIds: [created.data.id] }, "MCP");
    const multi = await service.createTodo(ownerA, { requestId: requestId(), title: "Several alters", priority: "HIGH", assigneeAlterIds: [created.data.id, second.data.id] }, "WEB");
    assert.deepEqual(zero.data.assigneeAlterIds, []);
    assert.deepEqual(one.data.assigneeAlterIds, [created.data.id]);
    assert.equal(multi.data.assigneeAlterIds.length, 2);
    assert.equal((await service.listTodos(ownerA, { priority: ["HIGH"], assigneeAlterId: second.data.id })).data[0].id, multi.data.id);

    await assert.rejects(() => service.createTodo(ownerA, { requestId: requestId(), title: "Cross-owner", assigneeAlterIds: [foreign.data.id] }, "MCP"), (error) => error instanceof SystemError && error.code === "VALIDATION_ERROR");
    await assert.rejects(() => pool.query("insert into todo_assignee (owner_id, todo_id, alter_id) values ($1, $2::uuid, $3::uuid)", [ownerA, zero.data.id, foreign.data.id]), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "23503");

    const archivedTodo = await service.archiveTodo(ownerA, zero.data.id, { requestId: requestId(), expectedVersion: 1 }, "MCP");
    const restoredTodo = await service.restoreTodo(ownerA, zero.data.id, { requestId: requestId(), expectedVersion: archivedTodo.data.version }, "MCP");
    const erasedTodo = await service.eraseTodo(ownerA, zero.data.id, { requestId: requestId(), expectedVersion: restoredTodo.data.version }, "MCP");
    assert.equal(erasedTodo.data.erased, true);

    let preview = await service.previewEraseAlter(ownerA, created.data.id);
    assert.equal(preview.canErase, false);
    assert.equal(preview.blockers.todos, 2);

    await service.updateTodo(ownerA, one.data.id, { requestId: requestId(), expectedVersion: 1, assigneeAlterIds: [] }, "MCP");
    await service.updateTodo(ownerA, multi.data.id, { requestId: requestId(), expectedVersion: 1, assigneeAlterIds: [second.data.id] }, "MCP");
    const coverageId = randomUUID();
    const noteId = randomUUID();
    await pool.query("insert into coverage_assignment (id, owner_id, alter_id, starts_on, status, confirmed_at) values ($1, $2, $3, current_date, 'confirmed', now())", [coverageId, ownerA, created.data.id]);
    await pool.query("insert into system_note (id, owner_id, body, alter_id) values ($1, $2, $3, $4)", [noteId, ownerA, "A note blocker", created.data.id]);
    preview = await service.previewEraseAlter(ownerA, created.data.id);
    assert.deepEqual({ notes: preview.blockers.notes, coverage: preview.blockers.coverage }, { notes: 1, coverage: 1 });
    await service.setNoteAlter(ownerA, noteId, null, 1, requestId(), "MCP");
    await service.reassignCoverage(ownerA, coverageId, second.data.id, 1, requestId(), "MCP");

    const storageKey = `profiles/test/${randomUUID()}.webp`;
    await pool.query("insert into private_image (id, owner_id, alter_id, storage_key, content_type) values ($1, $2, $3, $4, 'image/webp')", [randomUUID(), ownerA, created.data.id, storageKey]);
    preview = await service.previewEraseAlter(ownerA, created.data.id);
    assert.equal(preview.canErase, true);
    assert.equal(preview.blockers.images, 1);
    assert.ok(preview.previewToken);

    const failingService = new SystemService(pool, async () => { throw new Error("Blob unavailable"); });
    const eraseRequest = requestId();
    await assert.rejects(() => failingService.eraseAlter(ownerA, created.data.id, { requestId: eraseRequest, expectedVersion: preview.version, previewToken: preview.previewToken! }, "MCP"), /Blob unavailable/);
    assert.equal((await service.getAlter(ownerA, created.data.id)).id, created.data.id);

    const erased = await service.eraseAlter(ownerA, created.data.id, { requestId: eraseRequest, expectedVersion: preview.version, previewToken: preview.previewToken! }, "MCP");
    assert.equal(erased.data.erased, true);
    assert.deepEqual(removedKeys, [storageKey]);
    const erasedReplay = await service.eraseAlter(ownerA, created.data.id, { requestId: eraseRequest, expectedVersion: preview.version, previewToken: preview.previewToken! }, "MCP");
    assert.equal(erasedReplay.replayed, true);

    const leakedActivity = await pool.query("select count(*) from activity_event where owner_id = $1 and row_to_json(activity_event)::text like $2", [ownerA, `%${sensitiveText}%`]);
    assert.equal(Number(leakedActivity.rows[0].count), 0);
    const eventShape = await pool.query("select source, changed_fields from activity_event where owner_id = $1 order by created_at asc", [ownerA]);
    assert.ok(eventShape.rows.some((row) => row.source === "MCP"));
    assert.ok(eventShape.rows.every((row) => Array.isArray(row.changed_fields)));
  } finally {
    const owners = [ownerA, ownerB];
    await pool.query("delete from activity_event where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from mutation_receipt where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from system_todo where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from system_note where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from coverage_assignment where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from fronting_session where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from alter_profile where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from system_preference where owner_id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.query("delete from app_user where id = any($1::text[])", [owners]).catch(() => undefined);
    await pool.end();
  }
});
