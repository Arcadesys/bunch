import assert from "node:assert/strict";
import test from "node:test";
import { postgresDateOnly } from "@/server/repository";

test("postgresDateOnly preserves SQL date values returned as Date objects", () => {
  assert.equal(postgresDateOnly(new Date(2026, 7, 30)), "2026-08-30");
});

test("postgresDateOnly accepts ISO date strings and timestamps", () => {
  assert.equal(postgresDateOnly("2026-08-30"), "2026-08-30");
  assert.equal(postgresDateOnly("2026-08-30T05:00:00.000Z"), "2026-08-30");
});

test("postgresDateOnly rejects values without an ISO date prefix", () => {
  assert.throws(() => postgresDateOnly("Sun Aug 30"), /Invalid Postgres date value/);
});
