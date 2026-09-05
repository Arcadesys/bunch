import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SystemError } from "@/server/system-error";
import { SystemService } from "@/server/system-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

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
