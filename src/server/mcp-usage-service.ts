import type { Pool } from "pg";
import { getDatabasePool } from "@/db/client";

export type UsageStats = {
  windowDays: number;
  totalInvocations: number;
  totalErrors: number;
  byTool: Array<{ tool: string; count: number; errors: number }>;
  byDay: Array<{ day: string; count: number }>;
  byOwner: Array<{ ownerId: string; count: number }>;
  aiSpend: {
    totalUsd: number;
    meaningfulActions: number;
    costPerActionUsd: number;
    activeUserDays: number;
    costPerActiveUserDayUsd: number;
    chargedFailures: number;
    estimatedRows: number;
    economyActions: number;
    byAction: Array<{ action: string; costUsd: number; actions: number }>;
    byModelQuality: Array<{ model: string; quality: string; costUsd: number; actions: number }>;
    byAccount: Array<{ ownerId: string; costUsd: number; actions: number }>;
    byDay: Array<{ day: string; costUsd: number; actions: number }>;
  };
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
    const [totals, byTool, byDay, byOwner, aiTotals, activeDays, spendByAction, spendByModel, spendByAccount, spendByDay] = await Promise.all([
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
      pool.query<{ cost: string; actions: string; failures: string; estimated: string; economy: string }>(`select
        coalesce(sum(coalesce(u.cost_microusd,u.projected_cost_microusd,0)),0)::bigint as cost,
        count(*)::int as actions,
        count(*) filter(where coalesce(n.state,g.state)='FAILED')::int as failures,
        count(*) filter(where u.cost_status='ESTIMATED')::int as estimated,
        count(*) filter(where u.route='ECONOMY')::int as economy
        from image_usage u left join native_scene_render n on u.job_kind='native' and u.job_id=n.id left join group_photo_render g on u.job_kind='group' and u.job_id=g.id
        where u.state='DISPATCHED' and u.created_at >= $1`, [since]),
      pool.query<{ count: string }>(`select count(*)::int as count from (
        select owner_id,(created_at at time zone 'America/Chicago')::date as day from mcp_invocation where created_at >= $1
        union select owner_id,(created_at at time zone 'America/Chicago')::date from activity_event where created_at >= $1
        union select owner_id,admitted_on from image_usage where created_at >= $1 and state='DISPATCHED'
      ) active`, [since]),
      pool.query<{ action: string; cost: string; actions: string }>(`select action,coalesce(sum(coalesce(cost_microusd,projected_cost_microusd,0)),0)::bigint as cost,count(*)::int as actions from image_usage where state='DISPATCHED' and created_at >= $1 group by action order by cost desc`, [since]),
      pool.query<{ model: string; quality: string; cost: string; actions: string }>(`select model,quality,coalesce(sum(coalesce(cost_microusd,projected_cost_microusd,0)),0)::bigint as cost,count(*)::int as actions from image_usage where state='DISPATCHED' and created_at >= $1 group by model,quality order by cost desc`, [since]),
      pool.query<{ owner_id: string; cost: string; actions: string }>(`select owner_id,coalesce(sum(coalesce(cost_microusd,projected_cost_microusd,0)),0)::bigint as cost,count(*)::int as actions from image_usage where state='DISPATCHED' and created_at >= $1 group by owner_id order by cost desc limit 25`, [since]),
      pool.query<{ day: string; cost: string; actions: string }>(`select to_char(date_trunc('day',created_at at time zone 'America/Chicago'),'YYYY-MM-DD') as day,coalesce(sum(coalesce(cost_microusd,projected_cost_microusd,0)),0)::bigint as cost,count(*)::int as actions from image_usage where state='DISPATCHED' and created_at >= $1 group by 1 order by 1`, [since]),
    ]);
    const ai = aiTotals.rows[0];
    const cost = Number(ai?.cost ?? 0);
    const actions = Number(ai?.actions ?? 0);
    const ownerDays = Number(activeDays.rows[0]?.count ?? 0);
    const usd = (micro: string | number) => Number((Number(micro) / 1_000_000).toFixed(6));
    return {
      windowDays,
      totalInvocations: Number(totals.rows[0]?.total ?? 0),
      totalErrors: Number(totals.rows[0]?.errors ?? 0),
      byTool: byTool.rows.map((row) => ({ tool: row.tool_name, count: Number(row.count), errors: Number(row.errors) })),
      byDay: byDay.rows.map((row) => ({ day: row.day, count: Number(row.count) })),
      byOwner: byOwner.rows.map((row) => ({ ownerId: row.owner_id, count: Number(row.count) })),
      aiSpend: {
        totalUsd: usd(cost), meaningfulActions: actions, costPerActionUsd: actions ? usd(cost / actions) : 0,
        activeUserDays: ownerDays, costPerActiveUserDayUsd: ownerDays ? usd(cost / ownerDays) : 0,
        chargedFailures: Number(ai?.failures ?? 0), estimatedRows: Number(ai?.estimated ?? 0), economyActions: Number(ai?.economy ?? 0),
        byAction: spendByAction.rows.map(row => ({ action: row.action, costUsd: usd(row.cost), actions: Number(row.actions) })),
        byModelQuality: spendByModel.rows.map(row => ({ model: row.model, quality: row.quality, costUsd: usd(row.cost), actions: Number(row.actions) })),
        byAccount: spendByAccount.rows.map(row => ({ ownerId: row.owner_id, costUsd: usd(row.cost), actions: Number(row.actions) })),
        byDay: spendByDay.rows.map(row => ({ day: row.day, costUsd: usd(row.cost), actions: Number(row.actions) })),
      },
    };
  }
}

export const getMcpUsageService = () => new McpUsageService();
