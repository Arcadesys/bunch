import type { Pool } from "pg";
import { getDatabasePool } from "@/db/client";

export type UsageStats = {
  windowDays: number;
  totalInvocations: number;
  totalErrors: number;
  byTool: Array<{ tool: string; count: number; errors: number }>;
  byDay: Array<{ day: string; count: number }>;
  byOwner: Array<{ ownerId: string; count: number }>;
};

export class McpUsageService {
  // The pool is resolved lazily (never in the constructor): createMcpServer builds
  // this service on every call, including in unit tests that never set DATABASE_URL,
  // and record() below must be able to swallow "Postgres is not configured" rather
  // than throw it during server construction.
  constructor(private readonly poolOverride?: Pool) {}
  private pool() {
    return this.poolOverride ?? getDatabasePool();
  }

  // Never let a logging failure break the tool call it is recording.
  async record(ownerId: string, toolName: string, durationMs: number, isError: boolean) {
    try {
      await this.pool().query(
        "insert into mcp_invocation(owner_id, tool_name, duration_ms, is_error) values ($1, $2, $3, $4)",
        [ownerId, toolName, durationMs, isError],
      );
    } catch (error) {
      console.error("[mcp-usage] failed to record invocation", error);
    }
  }

  async summary(windowDays: number): Promise<UsageStats> {
    const since = new Date(Date.now() - windowDays * 86400000);
    const pool = this.pool();
    const [totals, byTool, byDay, byOwner] = await Promise.all([
      pool.query<{ total: string; errors: string }>(
        "select count(*) as total, count(*) filter (where is_error) as errors from mcp_invocation where created_at >= $1",
        [since],
      ),
      pool.query<{ tool_name: string; count: string; errors: string }>(
        "select tool_name, count(*) as count, count(*) filter (where is_error) as errors from mcp_invocation where created_at >= $1 group by tool_name order by count(*) desc",
        [since],
      ),
      pool.query<{ day: string; count: string }>(
        "select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, count(*) as count from mcp_invocation where created_at >= $1 group by 1 order by 1",
        [since],
      ),
      pool.query<{ owner_id: string; count: string }>(
        "select owner_id, count(*) as count from mcp_invocation where created_at >= $1 group by owner_id order by count(*) desc limit 25",
        [since],
      ),
    ]);
    return {
      windowDays,
      totalInvocations: Number(totals.rows[0]?.total ?? 0),
      totalErrors: Number(totals.rows[0]?.errors ?? 0),
      byTool: byTool.rows.map((row) => ({ tool: row.tool_name, count: Number(row.count), errors: Number(row.errors) })),
      byDay: byDay.rows.map((row) => ({ day: row.day, count: Number(row.count) })),
      byOwner: byOwner.rows.map((row) => ({ ownerId: row.owner_id, count: Number(row.count) })),
    };
  }
}

export const getMcpUsageService = () => new McpUsageService();
