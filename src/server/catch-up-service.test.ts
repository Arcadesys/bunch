import assert from "node:assert/strict";
import test from "node:test";
import { CatchUpService } from "@/server/catch-up-service";
import { prepareConversationCatchUpSchema } from "@/domain/catch-up";

const demoAlterId = "11111111-1111-4111-8111-111111111111";
const profileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const frontingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const catchUpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function queryFixture(rows: unknown[][]) {
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: rows.shift() ?? [] };
    },
    release() {},
  };
  return { service: new CatchUpService({ connect: async () => client } as never), calls };
}

function recordedRows(options: { persisted?: { id: string; window_start: string | null; window_end: string }; previous?: string | null; current?: boolean } = {}) {
  const current = options.current ?? true;
  const rows: unknown[][] = [[{ id: profileId, name: "Mouse Arcade" }], []];
  if (!current) return rows.concat([[]]);
  rows.push([{ id: frontingId, started_at: "2026-09-04T15:15:00.000Z" }]);
  rows.push(options.persisted ? [options.persisted] : []);
  if (!options.persisted) rows.push(options.previous === null ? [] : [{ ended_at: options.previous ?? "2026-09-03T19:00:00.000Z" }]);
  return rows;
}

test("conversation catch-up accepts an explicit corrected Chicago window without writing state", async () => {
  const ownerId = `demo:conversation-${crypto.randomUUID()}`;
  const service = new CatchUpService({} as never);
  const handoff = await service.prepareConversationCatchUp(ownerId, {
    alterId: demoAlterId,
    startAt: "2026-09-03T14:00:00-05:00",
    endAt: "2026-09-04T10:15:00-05:00",
    timeZone: "America/Chicago",
  });
  assert.equal(handoff.status, "READY");
  assert.deepEqual(handoff.window, {
    startAt: "2026-09-03T19:00:00.000Z",
    endAt: "2026-09-04T15:15:00.000Z",
    timeZone: "America/Chicago",
    provenance: "USER_SELECTED",
  });
  assert.equal(handoff.historyAccess, "HOST_REQUIRED");
  assert.match(handoff.instructions.join(" "), /cannot retrieve other conversations/i);
});

test("conversation catch-up validates paired timestamps, order, and IANA zones", () => {
  const base = { alterId: demoAlterId, timeZone: "America/Chicago" };
  assert.equal(prepareConversationCatchUpSchema.safeParse({ ...base, startAt: "2026-09-03T14:00:00-05:00" }).success, false);
  assert.equal(prepareConversationCatchUpSchema.safeParse({ ...base, startAt: "2026-09-04T10:15:00-05:00", endAt: "2026-09-03T14:00:00-05:00" }).success, false);
  assert.equal(prepareConversationCatchUpSchema.safeParse({ ...base, timeZone: "CST" }).success, false);
  assert.equal(prepareConversationCatchUpSchema.safeParse(base).success, true);
});

test("explicit DST offsets are authoritative while timezone is display context", async () => {
  const { service, calls } = queryFixture([[{ id: profileId, name: "Mouse Arcade" }]]);
  const handoff = await service.prepareConversationCatchUp("owner:one", { alterId: profileId, startAt: "2026-03-08T01:30:00-06:00", endAt: "2026-03-08T03:30:00-05:00", timeZone: "America/Chicago" });
  assert.deepEqual(handoff.window, { startAt: "2026-03-08T07:30:00.000Z", endAt: "2026-03-08T08:30:00.000Z", timeZone: "America/Chicago", provenance: "USER_SELECTED" });
  assert.equal(calls.length, 1, "explicit correction validates the owner-scoped profile but does not consult history");
  assert.ok(calls.every(({ sql }) => !/insert|update|delete|begin/i.test(sql)), "read-only handoff must not write");
});

test("recorded current profile window uses persisted catch-up dates and remains repeatable without writes", async () => {
  const persisted = { id: catchUpId, window_start: "2026-09-03T19:00:00.000Z", window_end: "2026-09-04T15:15:00.000Z" };
  const { service, calls } = queryFixture([...recordedRows({ persisted }), ...recordedRows({ persisted })]);
  const input = { alterId: profileId, timeZone: "America/Chicago" };
  const first = await service.prepareConversationCatchUp("owner:one", input);
  const second = await service.prepareConversationCatchUp("owner:one", input);
  assert.equal(first.status, "READY");
  assert.deepEqual(second.window, first.window);
  assert.equal(first.source?.catchUpSessionId, catchUpId);
  assert.ok(calls.every(({ values }) => values?.[0] === "owner:one"), "each read remains owner-scoped");
  assert.ok(calls.every(({ sql }) => !/insert|update|delete|begin/i.test(sql)), "repeat handoff creates no sessions or entries");
});

test("recorded previous session is used only for the named current profile", async () => {
  const { service, calls } = queryFixture(recordedRows());
  const handoff = await service.prepareConversationCatchUp("owner:one", { alterId: profileId, timeZone: "America/Chicago" });
  assert.deepEqual(handoff.window, { startAt: "2026-09-03T19:00:00.000Z", endAt: "2026-09-04T15:15:00.000Z", timeZone: "America/Chicago", provenance: "RECORDED_FRONTING_WINDOW" });
  assert.equal(calls[1].values?.[1], profileId);
  assert.equal(calls[4].values?.[1], profileId);
});

test("unknown, non-current, and malformed recorded history require selected dates", async () => {
  for (const rows of [
    recordedRows({ current: false }),
    recordedRows({ previous: null }),
    recordedRows({ persisted: { id: catchUpId, window_start: "2026-09-04T16:00:00.000Z", window_end: "2026-09-04T15:15:00.000Z" } }),
    recordedRows({ previous: "2026-09-04T16:00:00.000Z" }),
  ]) {
    const { service } = queryFixture(rows);
    const handoff = await service.prepareConversationCatchUp("owner:one", { alterId: profileId, timeZone: "America/Chicago" });
    assert.equal(handoff.status, "NEEDS_DATES");
    assert.equal(handoff.window, undefined);
  }
});

test("conversation catch-up rejects a non-owned demo profile and does not create a digest", async () => {
  const service = new CatchUpService({} as never);
  await assert.rejects(() => service.prepareConversationCatchUp(`demo:conversation-${crypto.randomUUID()}`, { alterId: crypto.randomUUID(), timeZone: "America/Chicago" }), /not found/);
});

test("demo catch-up review state does not mutate the underlying item", async () => {
  const ownerId = `demo:test-${crypto.randomUUID()}`;
  const service = new CatchUpService({} as never);
  const before = await service.openForCurrentFront(ownerId);
  assert.ok(before);
  const item = before.items[0];
  const originalTitle = item.title;
  const result = await service.setItemState(ownerId, item.entryId, {
    requestId: crypto.randomUUID(),
    expectedVersion: item.version,
    state: "RESOLVED",
  }, "WEB");
  const changed = result.data.items.find((candidate) => candidate.entryId === item.entryId);
  assert.equal(changed?.reviewState, "RESOLVED");
  assert.equal(changed?.title, originalTitle);
  assert.equal(result.data.reviewedCount, 1);
});

test("defer requires a return time", async () => {
  const ownerId = `demo:test-${crypto.randomUUID()}`;
  const service = new CatchUpService({} as never);
  const session = await service.openForCurrentFront(ownerId);
  assert.ok(session);
  await assert.rejects(() => service.setItemState(ownerId, session.items[0].entryId, {
    requestId: crypto.randomUUID(),
    expectedVersion: session.items[0].version,
    state: "DEFERRED",
  }, "WEB"), /Choose when this item should return/);
});

test("next switch is a distinct defer choice", async () => {
  const ownerId = `demo:test-${crypto.randomUUID()}`;
  const service = new CatchUpService({} as never);
  const session = await service.openForCurrentFront(ownerId);
  assert.ok(session);
  const result = await service.setItemState(ownerId, session.items[0].entryId, {
    requestId: crypto.randomUUID(),
    expectedVersion: session.items[0].version,
    state: "DEFERRED",
    deferUntilNextSwitch: true,
  }, "WEB");
  assert.equal(result.data.items[0].deferUntilNextSwitch, true);
});

test("thread suggestions are retry-safe and remain unconfirmed", async () => {
  const ownerId = `demo:test-${crypto.randomUUID()}`;
  const service = new CatchUpService({} as never);
  const requestId = crypto.randomUUID();
  const input = { requestId, source: "CODEX" as const, externalThreadId: "codex:test", url: "https://chatgpt.com/", title: "Reviewable thread", approvedSummary: "Approved summary only.", keyDecisionOrAction: "Confirm before catch-up.", recipientAlterIds: [] };
  const first = await service.suggestThread(ownerId, input, "MCP");
  const retry = await service.suggestThread(ownerId, input, "MCP");
  const firstData = first.data as { id: string; status: string };
  const retryData = retry.data as { id: string; status: string };
  assert.equal(firstData.status, "SUGGESTED");
  assert.equal(retryData.id, firstData.id);
  assert.equal(retry.replayed, true);
});

test("saved demo threads remain visible independently of catch-up and keep owner boundaries", async () => {
  const ownerId = `demo:test-${crypto.randomUUID()}`;
  const service = new CatchUpService({} as never);
  const created = await service.suggestThread(ownerId, { requestId: crypto.randomUUID(), source: "CODEX", externalThreadId: "saved", url: "https://example.com/thread", title: "Saved without a switch", approvedSummary: "Summary", keyDecisionOrAction: "Action", recipientAlterIds: [] }, "WEB");
  const saved = created.data as { id: string; version: number };
  assert.ok((await service.listThreads(ownerId)).every((thread) => !Array.isArray(thread) && typeof thread.id === "string"));
  assert.ok((await service.listThreads(ownerId)).some((thread) => thread.id === saved.id && thread.status === "SUGGESTED"));
  assert.ok(!(await service.listThreads(`demo:other-${crypto.randomUUID()}`)).some((thread) => thread.id === saved.id));
  await service.confirmThread(ownerId, saved.id, saved.version, crypto.randomUUID(), "WEB");
  assert.ok((await service.listThreads(ownerId)).some((thread) => thread.id === saved.id && thread.status === "CONFIRMED"));
  await assert.rejects(() => service.confirmThread(ownerId, saved.id, saved.version, crypto.randomUUID(), "WEB"), /Thread changed/);
});
