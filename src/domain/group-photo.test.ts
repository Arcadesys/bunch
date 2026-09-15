import assert from "node:assert/strict";
import test from "node:test";
import { nearestOccupancyZone, provisionalSceneAnalysis, sceneAnalysisSchema } from "./group-photo";

test("provisional analysis provides bounded, inspectable staging zones", () => {
  const analysis = sceneAnalysisSchema.parse(provisionalSceneAnalysis());
  assert.equal(analysis.source, "PROVISIONAL");
  assert.equal(nearestOccupancyZone(analysis, 50, 80).id, "front-row");
  assert.equal(nearestOccupancyZone(analysis, 50, 30).id, "back-row");
});

import { arrangePlacements, compositionGuidance, type GroupPhotoPlacement } from "./group-photo";
const placements = ["a", "b", "c"].map((id, index) => ({ id, alterId: id, tokenX: 10 + index * 5, tokenY: 60, depth: 50, relationHints: [], version: 1, createdAt: "2026-09-09", updatedAt: "2026-09-09" } satisfies GroupPhotoPlacement));

test("Arrange resolves equal depths consistently and moves across exactly one layer", () => {
  assert.deepEqual(arrangePlacements(placements, "a", "forward").map(p => p.id), ["b", "a", "c"]);
  assert.deepEqual(arrangePlacements(placements, "c", "backward").map(p => p.id), ["a", "c", "b"]);
  assert.deepEqual(arrangePlacements(placements, "a", "front").map(p => p.id), ["b", "c", "a"]);
  assert.deepEqual(arrangePlacements(placements, "c", "back").map(p => p.id), ["c", "a", "b"]);
  assert.deepEqual(arrangePlacements(placements, "a", "backward").map(p => p.id), ["a", "b", "c"]);
  assert.equal(new Set(arrangePlacements(placements, "a", "front").map(p => p.depth)).size, 3);
  assert.deepEqual(placements.map(p => p.depth), [50, 50, 50]);
});

test("composition preserves the left cluster with explicit coordinates and front-to-back convention", () => {
  const prompt = compositionGuidance(placements);
  for (const p of placements) assert.ok(prompt.includes(`Person ${p.alterId}: x ${p.tokenX}%, y 60%`));
  assert.match(prompt, /three people together on the left/);
  assert.match(prompt, /Larger depth means nearer/);
  assert.match(prompt, /natural poses/);
});
