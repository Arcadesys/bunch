import { test as base, expect } from "@playwright/test";
import type { CatchUpSession } from "../../src/domain/catch-up";
import type { FrontingSessionView } from "../../src/domain/contracts";

export const fixtureSession: CatchUpSession = {
  id: "10000000-0000-4000-8000-000000000001",
  alterId: "20000000-0000-4000-8000-000000000001",
  alterName: "Test Robin",
  startedAt: "2026-09-04T12:00:00.000Z",
  windowStart: "2026-09-01T12:00:00.000Z",
  windowEnd: "2026-09-04T12:00:00.000Z",
  firstTime: false, reviewedCount: 0, totalCount: 4, stateVersion: 1,
  items: (["NOTE", "TODO", "DECISION", "THREAD"] as const).map((itemType, index) => ({
    entryId: `30000000-0000-4000-8000-00000000000${index + 1}`,
    itemId: `40000000-0000-4000-8000-00000000000${index + 1}`,
    itemType, title: `Fixture ${itemType.toLowerCase()}`,
    whyItMatters: "Synthetic approved context for browser testing.",
    fromLabel: "Test Finch", toLabel: "Test Robin",
    timestamp: "2026-09-03T12:00:00.000Z",
    nextAction: "Review this synthetic record.", reviewState: "NEW", version: 1,
    ...(itemType === "TODO" ? { statusLabel: "BLOCKED", dueOn: "2026-09-05" } : {}),
    ...(itemType === "THREAD" ? { threadSource: "CHATGPT" as const, threadUrl: "https://example.invalid/approved-thread" } : {}),
  })),
};

type Write = { method: string; path: string; body: Record<string, unknown>; requestId: string | undefined };
type StoredRecord = { id: string; version: number; updatedAt: string; createdAt: string; [key: string]: unknown };
type Harness = {
  saved: Record<string, StoredRecord[]>;
  session: CatchUpSession | null; readStatus: number; writeStatus: number; writes: Write[]; unexpected: string[];
  currentFront: FrontingSessionView | null; profiles: { id: string; name: string }[];
  switchReadStatus: number; switchDelay: number; loseSwitchResponse: boolean; switchCount: number;
  profilePageSize: number; profileReads: number;
};

export const test = base.extend<{ harness: Harness }>({
  harness: [async ({ context }, use) => {
    const stamp = "2026-09-04T12:00:00.000Z";
    const harness: Harness = {
      saved: {
        todos: [{ id: "40000000-0000-4000-8000-000000000002", title: "Fixture todo", status: "BLOCKED", priority: "NORMAL", assigneeAlterIds: [], version: 1, updatedAt: stamp, createdAt: stamp }],
        notes: [{ id: "40000000-0000-4000-8000-000000000001", body: "Fixture note", version: 1, updatedAt: stamp, createdAt: stamp }],
        "important-threads": [{ id: "40000000-0000-4000-8000-000000000004", title: "Fixture thread", url: "https://example.invalid/approved-thread", approvedSummary: "Synthetic saved summary", keyDecisionOrAction: "Review this record", recipients: [], status: "CONFIRMED", version: 1, updatedAt: stamp, createdAt: stamp }],
      },
      session: structuredClone(fixtureSession), readStatus: 200, writeStatus: 200, writes: [], unexpected: [],
      currentFront: { id: "60000000-0000-4000-8000-000000000001", alterId: fixtureSession.alterId, alterName: fixtureSession.alterName, startedAt: fixtureSession.startedAt, version: 1 },
      profiles: [{ id: fixtureSession.alterId, name: "Test Robin" }, { id: "20000000-0000-4000-8000-000000000002", name: "Test Finch" }],
      switchReadStatus: 200, switchDelay: 0, loseSwitchResponse: false, switchCount: 0,
      profilePageSize: 100, profileReads: 0,
    };
    const switchReceipts = new Map<string, unknown>();
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:3217") {
        harness.unexpected.push(`External request: ${url.origin}`);
        return route.abort();
      }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const reply = (data: unknown, status = 200) => route.fulfill({ status, json: status >= 400 ? { error: { message: status === 401 ? "Sign in to access private records." : "Record changed; reload before retrying." } } : { data } });
      if (url.pathname === "/api/v1/catch-up/current" && request.method() === "GET") return reply(harness.session, harness.readStatus);
      if (url.pathname === "/api/v1/fronting/current" && request.method() === "GET") return reply(harness.currentFront, harness.switchReadStatus);
      if (url.pathname === "/api/v1/alters" && request.method() === "GET") {
        harness.profileReads += 1;
        if (harness.switchReadStatus !== 200) return reply(null, harness.switchReadStatus);
        const offset = Number(url.searchParams.get("cursor") ?? 0);
        const next = offset + harness.profilePageSize;
        return route.fulfill({ json: { data: harness.profiles.slice(offset, next), meta: next < harness.profiles.length ? { nextCursor: String(next) } : {} } });
      }
      const recordKind = url.pathname.split("/")[3];
      if (harness.saved[recordKind] && request.method() === "GET") {
        if (harness.readStatus !== 200) return reply(null, harness.readStatus);
        return route.fulfill({ json: { data: harness.saved[recordKind], meta: {} } });
      }
      const allowed = /^\/api\/v1\/(catch-up\/items\/[^/]+|notes|todos(?:\/[^/]+)?|fronting\/switch|important-threads(?:\/[^/]+\/confirm)?)$/;
      if (!allowed.test(url.pathname) || !["POST", "PATCH"].includes(request.method())) {
        harness.unexpected.push(`${request.method()} ${url.pathname}`);
        return route.fulfill({ status: 501, json: { error: { message: "Unmocked API blocked by test harness." } } });
      }
      const body = request.postDataJSON();
      harness.writes.push({ method: request.method(), path: url.pathname, body, requestId: request.headers()["idempotency-key"] });
      if (harness.writeStatus !== 200) return reply(null, harness.writeStatus);
      if (url.pathname === "/api/v1/fronting/switch") {
        const key = request.headers()["idempotency-key"];
        if (!key) return reply(null, 400);
        if (switchReceipts.has(key)) return reply(switchReceipts.get(key));
        if (body.expectedCurrentVersion !== (harness.currentFront?.version ?? null)
          || body.expectedCurrentSessionId !== (harness.currentFront?.id ?? null)) return reply(null, 409);
        const profile = harness.profiles.find((candidate) => candidate.id === body.alterId);
        if (!profile) return reply(null, 404);
        if (harness.switchDelay) await new Promise((resolve) => setTimeout(resolve, harness.switchDelay));
        const previous = harness.currentFront;
        harness.currentFront = { id: "60000000-0000-4000-8000-000000000002", alterId: profile.id, alterName: profile.name, startedAt: "2026-09-04T14:00:00.000Z", version: 1 };
        harness.session = { ...structuredClone(fixtureSession), alterId: profile.id, alterName: profile.name, items: [], totalCount: 0 };
        const result = { current: harness.currentFront, previous, catchUp: harness.session };
        switchReceipts.set(key, result);
        harness.switchCount += 1;
        if (harness.loseSwitchResponse) { harness.loseSwitchResponse = false; return route.abort("failed"); }
        return reply(result);
      }
      if (harness.saved[recordKind]) {
        const records = harness.saved[recordKind];
        if (request.method() === "PATCH" || url.pathname.endsWith("/confirm")) {
          const record = records.find((item) => item.id === url.pathname.split("/")[4]);
          if (!record) return reply(null, 404);
          if (record.version !== body.expectedVersion) return reply(null, 409);
          Object.assign(record, { status: body.status ?? "CONFIRMED", version: record.version + 1 });
          return reply(record);
        }
        const id = `50000000-0000-4000-8000-${String(records.length + 1).padStart(12, "0")}`;
        const record: StoredRecord = { ...body, id, version: 1, updatedAt: stamp, createdAt: stamp };
        if (recordKind === "important-threads") Object.assign(record, { status: "SUGGESTED", recipients: (body.recipientAlterIds as string[]).map((id) => harness.profiles.find((profile) => profile.id === id)?.name ?? id) });
        records.unshift(record);
        return reply(record);
      }
      if (request.method() === "PATCH" && harness.session) {
        const item = harness.session.items.find((candidate) => url.pathname.endsWith(candidate.entryId));
        if (!item) return reply(null, 404);
        Object.assign(item, { reviewState: body.state, version: item.version + 1, deferUntil: body.deferUntil, deferUntilNextSwitch: body.deferUntilNextSwitch });
        harness.session.reviewedCount = harness.session.items.filter((candidate) => candidate.reviewState !== "NEW").length;
        return reply(harness.session);
      }
      return reply({ id: "50000000-0000-4000-8000-000000000001", version: 1, status: url.pathname.endsWith("/confirm") ? "CONFIRMED" : "SUGGESTED" });
    });
    await use(harness);
    expect(harness.unexpected, "No unmocked API or external requests may escape the fixture").toEqual([]);
  }, { auto: true }],
});

export { expect };
