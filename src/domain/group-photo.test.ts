import assert from "node:assert/strict";
import test from "node:test";
import { nearestOccupancyZone, provisionalSceneAnalysis, sceneAnalysisSchema } from "./group-photo";

test("provisional analysis provides bounded, inspectable staging zones", () => {
  const analysis = sceneAnalysisSchema.parse(provisionalSceneAnalysis());
  assert.equal(analysis.source, "PROVISIONAL");
  assert.equal(nearestOccupancyZone(analysis, 50, 80).id, "front-row");
  assert.equal(nearestOccupancyZone(analysis, 50, 30).id, "back-row");
});
