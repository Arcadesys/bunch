import assert from "node:assert/strict";
import test from "node:test";
import { suggestCoverage } from "@/domain/coverage";

test("a suggestion remains unassigned without an explicit signal or history", () => {
  const suggestion = suggestCoverage({ startsOn: "2026-08-31" }, []);
  assert.equal(suggestion.alterId, undefined);
  assert.match(suggestion.reasons[0], /No alter is assumed/);
});

test("a manual check-in outranks a past pattern and shared context is only a reason", () => {
  const suggestion = suggestCoverage(
    { startsOn: "2026-08-31", manualAlterId: "manual", sharedContext: "I chose to share this." },
    [{ id: "old", alterId: "history", alterName: "Past", startsOn: "2026-08-24" }],
  );
  assert.equal(suggestion.alterId, "manual");
  assert.equal(suggestion.reasons.length, 2);
  assert.match(suggestion.reasons[1], /explicitly shared/);
});
