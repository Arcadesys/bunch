import assert from "node:assert/strict";
import test from "node:test";
import { CatchUpService } from "./catch-up-service";
import { setCatchUpItemStateSchema } from "../domain/catch-up";

// Isolated in-memory service checks, not PostgreSQL integration claims.
function fixture() {
  const pool = new Proxy({}, { get() { throw new Error("Database access forbidden in this fixture"); } });
  return { service: new CatchUpService(pool as never), owner: `demo:regression-${crypto.randomUUID()}` };
}

test("review retry applies exactly once and stale subsequent writes are rejected", async () => {
  const { service, owner } = fixture();
  const session = await service.openForCurrentFront(owner);
  assert.ok(session);
  const entryId = session.items[0].entryId;
  const input = { requestId: crypto.randomUUID(), expectedVersion: 1, state: "ACKNOWLEDGED" as const };
  await service.setItemState(owner, entryId, input, "WEB");
  const retry = await service.setItemState(owner, entryId, input, "WEB");
  assert.equal(retry.replayed, true);
  assert.equal(retry.data.items[0].version, 2);
  assert.equal(retry.data.reviewedCount, 1);
  await assert.rejects(service.setItemState(owner, entryId, { ...input, requestId: crypto.randomUUID(), state: "RESOLVED" }, "WEB"), /changed since it was read/);
  assert.equal((await service.openForCurrentFront(owner))?.items[0].reviewState, "ACKNOWLEDGED");
});

test("review state and retry receipts stay isolated between fixture owners", async () => {
  const { service, owner } = fixture();
  const other = `demo:regression-${crypto.randomUUID()}`;
  const first = await service.openForCurrentFront(owner);
  const second = await service.openForCurrentFront(other);
  assert.ok(first && second);
  const requestId = crypto.randomUUID();
  await service.setItemState(owner, first.items[0].entryId, { requestId, expectedVersion: 1, state: "RESOLVED" }, "WEB");
  assert.equal(second.items[0].reviewState, "NEW");
  const result = await service.setItemState(other, second.items[0].entryId, { requestId, expectedVersion: 1, state: "ACKNOWLEDGED" }, "WEB");
  assert.equal(result.replayed, false);
  assert.equal(first.items[0].reviewState, "RESOLVED");
});

test("acknowledging a deferred item clears both return mechanisms without changing content", async () => {
  const { service, owner } = fixture();
  const session = await service.openForCurrentFront(owner);
  assert.ok(session);
  const original = structuredClone(session.items[1]);
  await service.setItemState(owner, original.entryId, { requestId: crypto.randomUUID(), expectedVersion: 1, state: "DEFERRED", deferUntilNextSwitch: true }, "WEB");
  const result = await service.setItemState(owner, original.entryId, { requestId: crypto.randomUUID(), expectedVersion: 2, state: "ACKNOWLEDGED" }, "WEB");
  const item = result.data.items[1];
  assert.equal(item.deferUntil, undefined);
  assert.equal(item.deferUntilNextSwitch, undefined);
  assert.equal(item.title, original.title);
  assert.equal(item.statusLabel, original.statusLabel);
  assert.equal(item.dueOn, original.dueOn);
  assert.equal(result.data.reviewedCount, 1);
});

test("unknown review entry cannot mutate the fixture", async () => {
  const { service, owner } = fixture();
  const before = structuredClone(await service.openForCurrentFront(owner));
  await assert.rejects(service.setItemState(owner, crypto.randomUUID(), { requestId: crypto.randomUUID(), expectedVersion: 1, state: "RESOLVED" }, "WEB"), /not found/);
  assert.deepEqual(await service.openForCurrentFront(owner), before);
});

test("defer contract rejects missing, conflicting, malformed and unexpected input", () => {
  const base = { requestId: crypto.randomUUID(), expectedVersion: 1, state: "DEFERRED" };
  for (const extra of [{}, { deferUntil: "not-a-date" }, { deferUntil: "2026-09-05T12:00:00Z", deferUntilNextSwitch: true }, { deferUntilNextSwitch: true, inferredFront: "someone" }]) {
    assert.equal(setCatchUpItemStateSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra));
  }
  assert.equal(setCatchUpItemStateSchema.safeParse({ ...base, deferUntilNextSwitch: true }).success, true);
  assert.equal(setCatchUpItemStateSchema.safeParse({ ...base, deferUntil: "2026-09-05T12:00:00Z" }).success, true);
});
