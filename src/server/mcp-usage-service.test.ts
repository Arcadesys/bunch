import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { McpUsageService } from "./mcp-usage-service";

test("usage summary reports cost per action and active user-day from the image ledger", async () => {
  const results = [
    { rows: [{ total: "8", errors: "1" }] },
    { rows: [{ tool_name: "generate_scene", count: "3", errors: "1" }] },
    { rows: [{ day: "2026-09-19", count: "8" }] },
    { rows: [{ owner_id: "owner-a", count: "8" }] },
    { rows: [{ cost: "390000", actions: "3", failures: "1", estimated: "1", economy: "2" }] },
    { rows: [{ count: "3" }] },
    { rows: [{ action: "generation", cost: "240000", actions: "2" }, { action: "repair", cost: "150000", actions: "1" }] },
    { rows: [{ model: "gpt-image-2", quality: "low", cost: "240000", actions: "2" }] },
    { rows: [{ owner_id: "owner-a", cost: "390000", actions: "3" }] },
    { rows: [{ day: "2026-09-19", cost: "390000", actions: "3" }] },
  ];
  const pool = { query: async () => results.shift() } as unknown as Pool;

  const stats = await new McpUsageService(pool).summary(30);

  assert.equal(stats.aiSpend.totalUsd, 0.39);
  assert.equal(stats.aiSpend.costPerActionUsd, 0.13);
  assert.equal(stats.aiSpend.costPerActiveUserDayUsd, 0.13);
  assert.equal(stats.aiSpend.chargedFailures, 1);
  assert.equal(stats.aiSpend.estimatedRows, 1);
  assert.equal(stats.aiSpend.economyActions, 2);
  assert.deepEqual(stats.aiSpend.byAction[0], { action: "generation", costUsd: 0.24, actions: 2 });
});
