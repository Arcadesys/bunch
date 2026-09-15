import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SystemError } from "@/server/system-error";
import { SystemService } from "@/server/system-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("journal edits and checklist retries persist; deleting a linked task preserves its journal", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const service = new SystemService(pool);
  const owner = `test:${randomUUID()}`;
  const foreign = `test:${randomUUID()}`;
  try {
    const noteInput = { requestId: randomUUID(), body: "Independent journal" };
    const note = await service.createNote(owner, noteInput, "WEB");
    assert.equal((await service.createNote(owner, noteInput, "WEB")).replayed, true);
    const created = await service.createTodo(owner, { requestId: randomUUID(), title: "Linked task", status: "OPEN" }, "WEB");
    const task = await service.updateTodo(owner, created.data.id, { requestId: randomUUID(), expectedVersion: created.data.version, noteIds: [note.data.id] }, "WEB");
    const freshNote = await service.getNote(owner, note.data.id);
    const editInput = { requestId: randomUUID(), expectedVersion: freshNote.version, body: "Revised journal entry" };
    const edited = await service.updateNote(owner, note.data.id, editInput, "MCP");
    const replayed = await service.updateNote(owner, note.data.id, editInput, "MCP");
    assert.equal(replayed.replayed, true);
    assert.deepEqual(replayed.data, edited.data);
    const anotherReader = new SystemService(pool);
    assert.equal((await anotherReader.getNote(owner, note.data.id)).body, editInput.body);
    assert.deepEqual((await anotherReader.getTodo(owner, task.data.id)).noteIds, [note.data.id]);
    await assert.rejects(service.updateNote(owner, note.data.id, { ...editInput, requestId: randomUUID() }, "WEB"), (error) => error instanceof SystemError && error.code === "CONFLICT");
    await service.createTodo(foreign, { requestId: randomUUID(), title: "Other system" }, "WEB");
    await assert.rejects(service.getNote(foreign, note.data.id), (error) => error instanceof SystemError && error.code === "NOT_FOUND");
    const itemInput = { requestId: randomUUID(), expectedVersion: task.data.version, title: "Checklist step" };
    const item = await service.createChecklistItem(owner, task.data.id, itemInput, "WEB");
    const itemReplay = await service.createChecklistItem(owner, task.data.id, itemInput, "WEB");
    assert.equal(itemReplay.replayed, true);
    assert.equal((await anotherReader.getTodo(owner, task.data.id)).checklist.length, 1);
    await assert.rejects(service.updateChecklistItem(foreign, task.data.id, item.data.checklist[0].id, { requestId: randomUUID(), expectedVersion: item.data.version, completed: true }, "WEB"), (error) => error instanceof SystemError && error.code === "NOT_FOUND");
    const completed = await service.updateChecklistItem(owner, task.data.id, item.data.checklist[0].id, { requestId: randomUUID(), expectedVersion: item.data.version, completed: true, title: "Revised step" }, "WEB");
    assert.equal(completed.data.status, "OPEN");
    assert.equal((await anotherReader.getTodo(owner, task.data.id)).checklist[0].title, "Revised step");
    const eraseInput = { requestId: randomUUID(), expectedVersion: completed.data.version };
    await service.eraseTodo(owner, task.data.id, eraseInput, "WEB");
    assert.equal((await service.eraseTodo(owner, task.data.id, eraseInput, "WEB")).replayed, true);
    const surviving = await anotherReader.getNote(owner, note.data.id);
    assert.equal(surviving.body, "Revised journal entry");
    assert.deepEqual(surviving.taskIds, []);
    assert.ok(surviving.version > edited.data.version);
    assert.equal((await pool.query("select count(*)::int as count from todo_checklist_item where owner_id = $1", [owner])).rows[0].count, 0);
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [[owner, foreign]]);
    await pool.end();
  }
});
