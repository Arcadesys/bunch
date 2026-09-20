import assert from "node:assert/strict";
import test from "node:test";
import type { PresencePeriod } from "./presence";
import { elapsed, initials, loggedHeadline, recentSwitches, switchEventLine, tapIntent } from "./switch-dock";

const period = (alterId: string, kind: PresencePeriod["kind"], startedAt: string, endedAt?: string): PresencePeriod => ({
  id: `${alterId}-${kind}-${startedAt}`, alterId, alterName: alterId, kind, origin: "EXPLICIT", startedAt, endedAt, version: 1,
});

test("a tap records the chosen role, and a second tap on the same person ends it", () => {
  const lucy = period("lucy", "FRONTING", "2026-09-14T11:00:00.000Z");
  const presence = { hosting: period("max", "HOSTING", "2026-09-14T09:00:00.000Z"), fronting: [lucy] };
  assert.deepEqual(tapIntent("HOST", "remy", presence), { action: "HOST" });
  assert.deepEqual(tapIntent("HOST", "max", presence), { action: "CLEAR" });
  assert.deepEqual(tapIntent("ALSO", "remy", presence), { action: "START" });
  assert.deepEqual(tapIntent("ALSO", "lucy", presence), { action: "END", episode: lucy });
  // Roles stay independent: a host tapped as "also here" starts an episode.
  assert.deepEqual(tapIntent("ALSO", "max", presence), { action: "START" });
  assert.deepEqual(tapIntent("HOST", "lucy", presence), { action: "HOST" });
});

test("recent switches list starts and ends without doubling a host handoff", () => {
  const records = [
    { ...period("lucy", "FRONTING", "2026-09-14T11:00:00.000Z"), energy: 3, trigger: "Stress" },
    period("max", "HOSTING", "2026-09-14T09:00:00.000Z"),
    period("remy", "HOSTING", "2026-09-14T06:00:00.000Z", "2026-09-14T09:00:00.000Z"),
    period("twi", "FRONTING", "2026-09-14T05:00:00.000Z", "2026-09-14T10:00:00.000Z"),
  ];
  const events = recentSwitches(records, 10);
  assert.deepEqual(events.map(switchEventLine), [
    "lucy came in alongside",
    "twi ended a fronting episode",
    "max started hosting",
    "remy started hosting",
    "twi came in alongside",
  ]);
  assert.equal(events[0].detail, "energy 3/5 · stress");
  assert.equal(recentSwitches(records, 2).length, 2);
  // Clearing hosting has no incoming host, so its end is listed.
  assert.equal(switchEventLine(recentSwitches([period("max", "HOSTING", "2026-09-14T09:00:00.000Z", "2026-09-14T12:00:00.000Z")])[0]), "max ended hosting");
});

test("labels stay short and readable", () => {
  assert.equal(initials("  lucy"), "L");
  assert.equal(initials(""), "?");
  const now = Date.parse("2026-09-14T12:00:00.000Z");
  assert.equal(elapsed("2026-09-14T11:59:00.000Z", now), "just now");
  assert.equal(elapsed("2026-09-14T11:18:00.000Z", now), "42m ago");
  assert.equal(elapsed("2026-09-14T09:00:00.000Z", now), "3h ago");
  assert.equal(elapsed("2026-09-12T12:00:00.000Z", now), "2d ago");
  assert.equal(loggedHeadline("END", "Lucy", "3:04 PM"), "Lucy’s episode ended · logged 3:04 PM");
});
