import type { Pool } from "pg";
import { z } from "zod";
import { getDatabasePool } from "@/db/client";
import { saveEpisodeReviewSchema, conversationSummarySchema, listConversationSummariesSchema, saveConversationSummarySchema } from "@/domain/conversation-summary";
import { PilotService } from "./pilot-service";
import { SystemError } from "./system-error";

// Every read re-parses the stored JSON through the zod schema, so the vocabulary in
// sourceReferences.kind is a persisted contract: narrowing it would turn existing rows
// into read errors rather than degrading gracefully.
const columns = `id,alter_id as "alterId",start_at as "startAt",end_at as "endAt",time_zone as "timeZone",summary,coverage,created_at as "createdAt",expires_at as "expiresAt",catch_up_session_id as "catchUpSessionId",revision,generated_at as "generatedAt",source_client as "sourceClient",source_references as "sourceReferences"`;
function view(row: Record<string, unknown>) {
  return conversationSummarySchema.parse(Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : v])));
}
export class ConversationSummaryService {
  private pilot: PilotService;
  constructor(private pool: Pool = getDatabasePool()) { this.pilot = new PilotService(pool); }
  async save(ownerId: string, raw: z.input<typeof saveConversationSummarySchema>) {
    const input = saveConversationSummarySchema.parse(raw);
    if (process.env.NODE_ENV === "production" && !process.env.CRON_SECRET)
      throw new SystemError("FORBIDDEN", "Catch-up retention is not configured yet. The summary was not saved.");
    await this.pilot.assertAccess(ownerId);
    return this.pilot.transaction(async c => {
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [ownerId + input.requestId]);
      const prior = (await c.query("select operation,result from mutation_receipt where owner_id=$1 and request_id=$2", [ownerId,input.requestId])).rows[0];
      if (prior) {
        if (prior.operation !== "save_conversation_catch_up") throw new SystemError("CONFLICT", "This requestId belongs to another operation.");
        return { ...prior.result, replayed: true } as { id: string; expiresAt: string; replayed: boolean };
      }
      const alter = await c.query("select 1 from alter_profile where owner_id=$1 and id=$2 and archived_at is null", [ownerId,input.alterId]);
      if (!alter.rowCount) throw new SystemError("NOT_FOUND", "Profile not found.");
      const row = (await c.query(`insert into conversation_summary (owner_id,alter_id,start_at,end_at,time_zone,summary,coverage) values ($1,$2,$3,$4,$5,$6,$7) returning id,expires_at`, [ownerId,input.alterId,input.startAt,input.endAt,input.timeZone,input.summary,input.coverage])).rows[0];
      const result = { id: row.id as string, expiresAt: row.expires_at.toISOString() as string };
      // Keep only a tombstone on retries: no summary, transcript, or coverage text.
      await c.query("insert into mutation_receipt (owner_id,request_id,operation,result) values ($1,$2,'save_conversation_catch_up',$3)", [ownerId,input.requestId,JSON.stringify(result)]);
      return { ...result, replayed: false };
    });
  }
  async saveEpisodeReview(ownerId: string, raw: z.input<typeof saveEpisodeReviewSchema>) {
    const input = saveEpisodeReviewSchema.parse(raw);
    if (process.env.NODE_ENV === "production" && !process.env.CRON_SECRET)
      throw new SystemError("FORBIDDEN", "Catch-up retention is not configured yet. The review was not saved.");
    await this.pilot.assertAccess(ownerId);
    return this.pilot.transaction(async c => {
      await c.query("select pg_advisory_xact_lock(hashtext($1))", [ownerId + input.requestId]);
      const prior = (await c.query("select operation,result from mutation_receipt where owner_id=$1 and request_id=$2", [ownerId,input.requestId])).rows[0];
      if (prior) {
        if (prior.operation !== "save_episode_review_v1" || prior.result.catchUpSessionId !== input.catchUpSessionId || prior.result.alterId !== input.alterId)
          throw new SystemError("CONFLICT", "This requestId belongs to another review.");
        return { ...prior.result, replayed: true };
      }
      const session = (await c.query(`select cs.alter_id,cs.window_start,cs.window_end,cs.narrative_revision,p.kind
        from catch_up_session cs join presence_period p on p.owner_id=cs.owner_id and p.id=cs.presence_period_id
        where cs.owner_id=$1 and cs.id=$2 for update of cs`, [ownerId,input.catchUpSessionId])).rows[0];
      if (!session || session.alter_id !== input.alterId || session.kind !== "FRONTING")
        throw new SystemError("NOT_FOUND", "Matching fronting catch-up session not found.");
      if (session.narrative_revision !== input.expectedRevision)
        throw new SystemError("CONFLICT", "Review revision changed. Read the current review before saving again.");
      const revision = session.narrative_revision + 1;
      const summary = `Overview\n${input.overview}\n\nWhat needs attention now\n${input.attentionNow}\n\nSignificant changes during the gap\n${input.significantChanges}`;
      const row = (await c.query(`insert into conversation_summary
        (owner_id,alter_id,start_at,end_at,time_zone,summary,coverage,catch_up_session_id,revision,generated_at,source_client,source_references)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id,expires_at`,
        [ownerId,input.alterId,session.window_start,session.window_end,input.timeZone,summary,input.coverage,input.catchUpSessionId,revision,input.generatedAt,input.sourceClient,JSON.stringify(input.sourceReferences)])).rows[0];
      await c.query("update catch_up_session set narrative_revision=$3 where owner_id=$1 and id=$2", [ownerId,input.catchUpSessionId,revision]);
      const result = { id: row.id as string, expiresAt: row.expires_at.toISOString() as string, revision, catchUpSessionId: input.catchUpSessionId, alterId: input.alterId };
      // Retry tombstone never retains narrative or memory-derived content.
      await c.query("insert into mutation_receipt(owner_id,request_id,operation,result) values($1,$2,'save_episode_review_v1',$3)", [ownerId,input.requestId,JSON.stringify(result)]);
      return { ...result, replayed: false };
    });
  }
  async forSession(ownerId: string, sessionId: string) {
    await this.pilot.assertAccess(ownerId);
    const session = (await this.pool.query("select narrative_revision from catch_up_session where owner_id=$1 and id=$2", [ownerId,z.uuid().parse(sessionId)])).rows[0];
    if (!session) throw new SystemError("NOT_FOUND", "Catch-up session not found.");
    const row = (await this.pool.query(`select ${columns} from conversation_summary where owner_id=$1 and catch_up_session_id=$2 and revision=$3 and expires_at>now() limit 1`, [ownerId,sessionId,session.narrative_revision])).rows[0];
    return { revision: session.narrative_revision as number, review: row ? view(row) : null };
  }
  async list(ownerId: string, raw: z.input<typeof listConversationSummariesSchema> = {}) {
    const input = listConversationSummariesSchema.parse(raw);
    await this.pilot.assertAccess(ownerId);
    const result = await this.pool.query(`select ${columns} from conversation_summary where owner_id=$1 and expires_at>now() and ($2::uuid is null or alter_id=$2) and ($3::timestamptz is null or created_at<$3) order by created_at desc,id desc limit $4`, [ownerId,input.alterId ?? null,input.before ?? null,input.limit]);
    return result.rows.map(view);
  }
  async get(ownerId: string, id: string) {
    await this.pilot.assertAccess(ownerId);
    const row = (await this.pool.query(`select ${columns} from conversation_summary where owner_id=$1 and id=$2 and expires_at>now()`, [ownerId,z.uuid().parse(id)])).rows[0];
    if (!row) throw new SystemError("NOT_FOUND", "Summary not found or expired.");
    return view(row);
  }
  async remove(ownerId: string, id: string) {
    await this.pilot.assertAccess(ownerId);
    await this.pool.query("delete from conversation_summary where owner_id=$1 and id=$2", [ownerId,z.uuid().parse(id)]);
  }
  async purgeExpired() {
    // Retention still applies to revoked accounts. Bypass only for expired-row deletion.
    return this.pilot.transaction(async c => {
      const owners = (await c.query("select distinct owner_id from conversation_summary where expires_at<=now()")).rows;
      let deleted = 0;
      for (const row of owners) {
        await c.query("select set_config('app.pilot_purge',$1,true)", [row.owner_id]);
        deleted += (await c.query("delete from conversation_summary where owner_id=$1 and expires_at<=now()", [row.owner_id])).rowCount ?? 0;
      }
      return deleted;
    });
  }
}
