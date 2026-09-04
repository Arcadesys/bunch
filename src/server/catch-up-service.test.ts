import assert from "node:assert/strict";
import test from "node:test";
import { CatchUpService } from "@/server/catch-up-service";

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
