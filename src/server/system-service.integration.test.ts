import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SystemError } from "@/server/system-error";
import { SystemService } from "@/server/system-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("generated gallery keepers are receipt-bound, idempotent, and do not change presence", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const service = new SystemService(pool, async () => undefined);
  const owner = `test:${randomUUID()}`;
  const otherOwner = `test:${randomUUID()}`;
  const requestId = randomUUID();
  const exactBytesHash = "a".repeat(64);
  try {
    const alter = await service.createAlter(owner, { requestId: randomUUID(), name: "Keeper" }, "SYSTEM");
    const first = await service.saveGeneratedGalleryResult(owner, alter.data.id, {
      id: randomUUID(), storageKey: `profiles/test/${randomUUID()}.png`, contentType: "image/png",
    }, { requestId, contentHash: exactBytesHash }, "SYSTEM");
    assert.equal(first.replayed, false);
    assert.equal(first.data.profilePictureChanged, false);

    const replay = await service.saveGeneratedGalleryResult(owner, alter.data.id, {
      id: randomUUID(), storageKey: `profiles/test/${randomUUID()}.png`, contentType: "image/png",
    }, { requestId, contentHash: exactBytesHash }, "SYSTEM");
    assert.equal(replay.replayed, true);
    assert.equal(replay.data.imageId, first.data.imageId);
    await assert.rejects(() => service.saveGeneratedGalleryResult(owner, alter.data.id, {
      id: randomUUID(), storageKey: `profiles/test/${randomUUID()}.png`, contentType: "image/png",
    }, { requestId, contentHash: "b".repeat(64) }, "SYSTEM"), (error) => error instanceof SystemError && error.code === "CONFLICT");
    await assert.rejects(() => service.saveGeneratedGalleryResult(otherOwner, alter.data.id, {
      id: randomUUID(), storageKey: `profiles/test/${randomUUID()}.png`, contentType: "image/png",
    }, { requestId: randomUUID(), contentHash: exactBytesHash }, "SYSTEM"), (error) => error instanceof SystemError && error.code === "NOT_FOUND");

    const images = await pool.query("select id, is_profile_picture from private_image where owner_id=$1 and alter_id=$2::uuid", [owner, alter.data.id]);
    assert.deepEqual(images.rows, [{ id: first.data.imageId, is_profile_picture: false }]);
    assert.equal((await pool.query("select count(*) from fronting_session where owner_id=$1", [owner])).rows[0].count, "0");
    assert.equal((await pool.query("select count(*) from system_host where owner_id=$1", [owner])).rows[0].count, "0");
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [[owner, otherOwner]]).catch(() => undefined);
    await pool.end();
  }
});

integrationTest("profile-picture backfill selects only profiles with exactly one image", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const owner = `test:${randomUUID()}`;
  try {
    await pool.query("insert into app_user (id, google_subject) values ($1, $1)", [owner]);
    const profiles = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of profiles.entries()) await pool.query("insert into alter_profile (id, owner_id, name) values ($1, $2, $3)", [id, owner, `Backfill ${index}`]);
    const images = [randomUUID(), randomUUID(), randomUUID()];
    await pool.query("insert into private_image (id, owner_id, alter_id, storage_key, content_type) values ($1, $2, $3, $4, 'image/png'), ($5, $2, $6, $7, 'image/png'), ($8, $2, $6, $9, 'image/png')", [images[0], owner, profiles[1], `profiles/test/${images[0]}`, images[1], profiles[2], `profiles/test/${images[1]}`, images[2], `profiles/test/${images[2]}`]);
    await pool.query(`with single_image_profiles as (
      select owner_id, alter_id from private_image where owner_id = $1 group by owner_id, alter_id having count(*) = 1
    ) update private_image image set is_profile_picture = true from single_image_profiles profile
      where image.owner_id = profile.owner_id and image.alter_id = profile.alter_id`, [owner]);
    const result = await pool.query("select alter_id, count(*) filter (where is_profile_picture)::int as active from private_image where owner_id = $1 group by alter_id", [owner]);
    const byProfile = new Map(result.rows.map((row) => [row.alter_id, row.active]));
    assert.equal(byProfile.get(profiles[1]), 1);
    assert.equal(byProfile.get(profiles[2]), 0);
    assert.equal(byProfile.has(profiles[0]), false);
  } finally {
    await pool.query("delete from app_user where id = $1", [owner]).catch(() => undefined);
    await pool.end();
  }
});

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

    const firstImageId = randomUUID();
    const secondImageId = randomUUID();
    const foreignImageId = randomUUID();
    await pool.query("insert into private_image (id, owner_id, alter_id, storage_key, content_type, created_at) values ($1, $2, $3, $4, 'image/png', now() - interval '1 minute'), ($5, $2, $3, $6, 'image/png', now())", [firstImageId, ownerA, created.data.id, `profiles/test/${firstImageId}.png`, secondImageId, `profiles/test/${secondImageId}.png`]);
    await pool.query("insert into private_image (id, owner_id, alter_id, storage_key, content_type) values ($1, $2, $3, $4, 'image/png')", [foreignImageId, ownerB, foreign.data.id, `profiles/test/${foreignImageId}.png`]);

    const pfpRequest = requestId();
    const firstPfp = await service.setProfilePicture(ownerA, created.data.id, { imageId: firstImageId, expectedVersion: 4, requestId: pfpRequest }, "WEB");
    assert.equal(firstPfp.data.profilePicture?.id, firstImageId);
    assert.deepEqual(firstPfp.data.images.map((image) => image.id), [secondImageId, firstImageId]);
    assert.equal(firstPfp.data.version, 5);
    const pfpReplay = await service.setProfilePicture(ownerA, created.data.id, { imageId: firstImageId, expectedVersion: 4, requestId: pfpRequest }, "WEB");
    assert.equal(pfpReplay.replayed, true);
    assert.deepEqual(pfpReplay.data, firstPfp.data);
    await assert.rejects(() => service.setProfilePicture(ownerA, created.data.id, { imageId: secondImageId, expectedVersion: 4, requestId: requestId() }, "WEB"), (error) => error instanceof SystemError && error.code === "CONFLICT");
    assert.equal((await service.getAlter(ownerA, created.data.id)).profilePicture?.id, firstImageId);
    await assert.rejects(() => service.setProfilePicture(ownerA, created.data.id, { imageId: foreignImageId, expectedVersion: 5, requestId: requestId() }, "WEB"), (error) => error instanceof SystemError && error.code === "NOT_FOUND");

    const secondPfp = await service.setProfilePicture(ownerA, created.data.id, { imageId: secondImageId, expectedVersion: 5, requestId: requestId() }, "MCP");
    assert.equal(secondPfp.data.profilePicture?.id, secondImageId);
    const retained = await pool.query("select id, is_profile_picture from private_image where owner_id = $1 and alter_id = $2 order by created_at", [ownerA, created.data.id]);
    assert.deepEqual(retained.rows.map((row) => ({ id: row.id, active: row.is_profile_picture })), [{ id: firstImageId, active: false }, { id: secondImageId, active: true }]);

    const competing = await Promise.allSettled([
      service.setProfilePicture(ownerA, created.data.id, { imageId: firstImageId, expectedVersion: 6, requestId: requestId() }, "MCP"),
      service.setProfilePicture(ownerA, created.data.id, { imageId: firstImageId, expectedVersion: 6, requestId: requestId() }, "WEB"),
    ]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(competing.filter((result) => result.status === "rejected" && result.reason instanceof SystemError && result.reason.code === "CONFLICT").length, 1);
    const activePfpCount = await pool.query("select count(*) from private_image where owner_id = $1 and alter_id = $2 and is_profile_picture = true", [ownerA, created.data.id]);
    assert.equal(Number(activePfpCount.rows[0].count), 1);

    const attachedImageId = randomUUID();
    const attachRequest = requestId();
    const attached = await service.attachAndSetProfilePicture(ownerA, created.data.id, { id: attachedImageId, storageKey: `profiles/test/${attachedImageId}.png`, contentType: "image/png" }, { expectedVersion: 7, requestId: attachRequest }, "SYSTEM");
    const attachReplay = await service.attachAndSetProfilePicture(ownerA, created.data.id, { id: randomUUID(), storageKey: `profiles/test/${randomUUID()}.png`, contentType: "image/png" }, { expectedVersion: 7, requestId: attachRequest }, "SYSTEM");
    assert.equal(attached.data.profilePicture?.id, attachedImageId);
    assert.equal(attachReplay.replayed, true);
    assert.deepEqual(attachReplay.data, attached.data);
    const attachedRows = await pool.query("select count(*) from private_image where owner_id = $1 and alter_id = $2", [ownerA, created.data.id]);
    assert.equal(Number(attachedRows.rows[0].count), 3);

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
    // Row versions restart at 1; the session ID prevents a stale screen from
    // accepting a different current front with the same version.
    await assert.rejects(() => service.switchCurrentFront(ownerA, {
      requestId: requestId(), alterId: created.data.id,
      expectedCurrentVersion: firstFront.data.current.version,
      expectedCurrentSessionId: firstFront.data.current.id,
    }, "WEB"), (error) => error instanceof SystemError && error.code === "CONFLICT");
    const unchanged = await service.switchCurrentFront(ownerA, {
      requestId: requestId(), alterId: second.data.id,
      expectedCurrentVersion: switched.data.current.version,
      expectedCurrentSessionId: switched.data.current.id,
    }, "WEB");
    assert.equal(unchanged.data.current.id, switched.data.current.id);
    const frontCounts = await pool.query("select count(*) as total, count(*) filter (where ended_at is null) as current from fronting_session where owner_id = $1", [ownerA]);
    assert.deepEqual({ total: Number(frontCounts.rows[0].total), current: Number(frontCounts.rows[0].current) }, { total: 2, current: 1 });

    const noteRequest = requestId();
    const note = await service.createNote(ownerA, { requestId: noteRequest, body: "Remember this exactly <3", alterId: second.data.id, actorAlterId: created.data.id }, "MCP");
    assert.equal(note.replayed, false);
    assert.equal(note.data.alterName, "Beacon");
    assert.equal(note.data.actorAlterName, "Aster");
    const gifted = await service.createNote(ownerA, { requestId: requestId(), body: "A picture for you", alterId: second.data.id, actorAlterId: created.data.id, giftImageIds: [firstImageId, secondImageId] }, "MCP");
    assert.deepEqual(gifted.data.giftImages.map((gift) => gift.imageId).sort(), [firstImageId, secondImageId].sort());
    assert.equal((await pool.query("select count(*) from system_note_gift_image where owner_id = $1 and note_id = $2::uuid", [ownerA, gifted.data.id])).rows[0].count, "2");
    await assert.rejects(() => service.createNote(ownerA, { requestId: requestId(), body: "No recipient", giftImageIds: [firstImageId] }, "MCP"), /Choose a recipient/);
    await assert.rejects(() => service.createNote(ownerA, { requestId: requestId(), body: "Foreign gift", alterId: second.data.id, giftImageIds: [foreignImageId] }, "MCP"), (error) => error instanceof SystemError && error.code === "VALIDATION_ERROR");
    const noteReplay = await service.createNote(ownerA, { requestId: noteRequest, body: "Ignored retry" }, "MCP");
    assert.equal(noteReplay.replayed, true);
    assert.deepEqual(noteReplay.data, note.data);
    assert.ok((await service.listNotes(ownerA, { alterId: second.data.id, actorAlterId: created.data.id })).data.some((candidate) => candidate.id === note.data.id));
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
    assert.equal(preview.blockers.images, 4);
    assert.ok(preview.previewToken);

    const failingService = new SystemService(pool, async () => { throw new Error("Blob unavailable"); });
    const eraseRequest = requestId();
    await assert.rejects(() => failingService.eraseAlter(ownerA, created.data.id, { requestId: eraseRequest, expectedVersion: preview.version, previewToken: preview.previewToken! }, "MCP"), /Blob unavailable/);
    assert.equal((await service.getAlter(ownerA, created.data.id)).id, created.data.id);

    const erased = await service.eraseAlter(ownerA, created.data.id, { requestId: eraseRequest, expectedVersion: preview.version, previewToken: preview.previewToken! }, "MCP");
    assert.equal(erased.data.erased, true);
    assert.deepEqual(removedKeys.sort(), [`profiles/test/${firstImageId}.png`, `profiles/test/${secondImageId}.png`, `profiles/test/${attachedImageId}.png`, storageKey].sort());
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

integrationTest("checklists and note references are owner-scoped, versioned, and preserve their opposite record", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const service = new SystemService(pool);
  const owner = `test:${randomUUID()}`;
  const other = `test:${randomUUID()}`;
  try {
    const note = await service.createNote(owner, { requestId: randomUUID(), body: "Independent journal note" }, "WEB");
    const createdTask = await service.createTodo(owner, { requestId: randomUUID(), title: "Board task" }, "WEB");
    const task = await service.updateTodo(owner, createdTask.data.id, { requestId: randomUUID(), expectedVersion: createdTask.data.version, noteIds: [note.data.id] }, "WEB");
    assert.deepEqual(task.data.noteIds, [note.data.id]);
    assert.deepEqual((await service.getNote(owner, note.data.id)).taskIds, [task.data.id]);
    const item = await service.createChecklistItem(owner, task.data.id, { requestId: randomUUID(), expectedVersion: task.data.version, title: "First step" }, "WEB");
    assert.equal(item.data.status, "INBOX");
    assert.equal(item.data.checklist[0].completed, false);
    const secondItem = await service.createChecklistItem(owner, task.data.id, { requestId: randomUUID(), expectedVersion: item.data.version, title: "Second step" }, "WEB");
    const reordered = await service.updateChecklistItem(owner, task.data.id, secondItem.data.checklist[1].id, { requestId: randomUUID(), expectedVersion: secondItem.data.version, position: 0 }, "WEB");
    assert.deepEqual(reordered.data.checklist.map(item => item.title), ["Second step", "First step"]);
    const completed = await service.updateChecklistItem(owner, task.data.id, reordered.data.checklist[1].id, { requestId: randomUUID(), expectedVersion: reordered.data.version, completed: true }, "WEB");
    assert.equal(completed.data.checklist.find((candidate) => candidate.title === "First step")?.completed, true);
    await assert.rejects(() => service.updateChecklistItem(owner, task.data.id, completed.data.checklist[0].id, { requestId: randomUUID(), expectedVersion: item.data.version, completed: false }, "WEB"), (error) => error instanceof SystemError && error.code === "CONFLICT");
    const concurrent = await Promise.allSettled([
      service.createChecklistItem(owner, task.data.id, { requestId: randomUUID(), expectedVersion: completed.data.version, title: "Only one wins" }, "WEB"),
      service.createChecklistItem(owner, task.data.id, { requestId: randomUUID(), expectedVersion: completed.data.version, title: "Stale concurrent write" }, "WEB"),
    ]);
    assert.deepEqual(concurrent.map(result => result.status).sort(), ["fulfilled", "rejected"]);
    const afterConcurrent = await service.getTodo(owner, task.data.id);
    const afterEraseItem = await service.eraseChecklistItem(owner, task.data.id, afterConcurrent.checklist[0].id, { requestId: randomUUID(), expectedVersion: afterConcurrent.version }, "WEB");
    assert.equal(afterEraseItem.data.checklist.length, afterConcurrent.checklist.length - 1);
    assert.deepEqual(afterEraseItem.data.checklist.map((candidate) => candidate.position), [0, 1]);
    const foreign = await service.createTodo(other, { requestId: randomUUID(), title: "Foreign task" }, "WEB");
    await assert.rejects(() => service.updateNote(owner, note.data.id, { requestId: randomUUID(), expectedVersion: note.data.version + 1, taskIds: [foreign.data.id] }, "WEB"), (error) => error instanceof SystemError && error.code === "VALIDATION_ERROR");
    const secondNote = await service.createNote(owner, { requestId: randomUUID(), body: "Concurrent reference note" }, "WEB");
    const secondTaskCreated = await service.createTodo(owner, { requestId: randomUUID(), title: "Concurrent reference task" }, "WEB");
    const secondTask = await service.updateTodo(owner, secondTaskCreated.data.id, { requestId: randomUUID(), expectedVersion: secondTaskCreated.data.version, noteIds: [secondNote.data.id] }, "WEB");
    const freshSecondNote = await service.getNote(owner, secondNote.data.id);
    const opposing = await Promise.allSettled([
      service.updateTodo(owner, secondTask.data.id, { requestId: randomUUID(), expectedVersion: secondTask.data.version, noteIds: [] }, "WEB"),
      service.updateNote(owner, secondNote.data.id, { requestId: randomUUID(), expectedVersion: freshSecondNote.version, taskIds: [] }, "WEB"),
    ]);
    assert.deepEqual(opposing.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
    const rejected = opposing.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.ok(rejected?.reason instanceof SystemError && rejected.reason.code === "CONFLICT");
    const cleared = await service.updateNote(owner, note.data.id, { requestId: randomUUID(), expectedVersion: note.data.version + 1, taskIds: [] }, "WEB");
    assert.deepEqual(cleared.data.taskIds, []);
    assert.deepEqual((await service.getTodo(owner, task.data.id)).noteIds, []);
    const relinked = await service.updateTodo(owner, task.data.id, { requestId: randomUUID(), expectedVersion: (await service.getTodo(owner, task.data.id)).version, noteIds: [note.data.id] }, "WEB");
    assert.deepEqual(relinked.data.noteIds, [note.data.id]);
    const refreshedNote = await service.getNote(owner, note.data.id);
    const removed = await service.eraseNote(owner, note.data.id, { requestId: randomUUID(), expectedVersion: refreshedNote.version }, "WEB");
    assert.equal(removed.data.removedTaskReferences, 1);
    assert.equal((await service.getTodo(owner, task.data.id)).noteIds.length, 0);
    assert.ok((await service.getTodo(owner, task.data.id)).checklist.length > 0);
    await service.eraseTodo(owner, task.data.id, { requestId: randomUUID(), expectedVersion: (await service.getTodo(owner, task.data.id)).version }, "WEB");
    assert.equal((await service.getTodo(other, foreign.data.id)).title, "Foreign task");
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [[owner, other]]).catch(() => undefined);
    await pool.end();
  }
});


integrationTest("moving a dated todo preserves its ISO due date through updates and reload", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const service = new SystemService(pool, async () => undefined);
  const owner = `test:${randomUUID()}`;
  try {
    const created = await service.createTodo(owner, {
      requestId: randomUUID(), title: "Dated drag regression", dueOn: "2026-09-07", status: "INBOX",
    }, "WEB");
    assert.equal(created.data.dueOn, "2026-09-07");
    let todo = created.data;
    for (const status of ["IN_PROGRESS", "BLOCKED", "DONE", "OPEN"] as const) {
      const moved = await service.updateTodo(owner, todo.id, {
        requestId: randomUUID(), expectedVersion: todo.version, status,
      }, "WEB");
      todo = await service.getTodo(owner, moved.data.id);
      assert.equal(todo.status, status);
      assert.equal(todo.dueOn, "2026-09-07");
    }
  } finally {
    await pool.query("delete from app_user where id = $1", [owner]);
    await pool.end();
  }
});
