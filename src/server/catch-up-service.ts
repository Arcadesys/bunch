import { uuidSchema } from "@/domain/contracts";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  catchUpSessionSchema,
  conversationCatchUpHandoffSchema,
  importantThreadCreateSchema,
  prepareConversationCatchUpSchema,
  setCatchUpItemStateSchema,
  systemDecisionCreateSchema,
  type CatchUpItem,
  type CatchUpItemType,
  type CatchUpSession,
  type ConversationCatchUpHandoff,
  type ImportantThreadCreate,
  type PrepareConversationCatchUp,
  type SetCatchUpItemState,
  type SystemDecisionCreate,
} from "@/domain/catch-up";
import type { RecordSource } from "@/domain/contracts";
import { getDatabasePool } from "@/db/client";
import { postgresDateOnly } from "@/server/repository";
import { SystemError } from "@/server/system-error";

// Use recorded instants, including offset/DST differences; retries never use wall-clock now.
function conversationHandoff(raw: unknown): ConversationCatchUpHandoff {
  const result = conversationCatchUpHandoffSchema.parse(raw);
  if (result.status === "READY" && result.window) {
    result.elapsedSeconds = (Date.parse(result.window.endAt) - Date.parse(result.window.startAt)) / 1000;
  }
  return conversationCatchUpHandoffSchema.parse(result);
}

type Candidate = Omit<CatchUpItem, "entryId" | "reviewState" | "deferUntil" | "version">;
type EntryRow = QueryResultRow & {
  id: string;
  item_type: CatchUpItemType;
  item_id: string;
  review_state: CatchUpItem["reviewState"];
  defer_until: Date | string | null;
  defer_until_next_switch: boolean;
  version: number;
};

type DemoSavedThread = ImportantThreadCreate & { id: string; status: "SUGGESTED" | "CONFIRMED"; version: number; createdAt: string; updatedAt: string };
const demoSavedThreads = new Map<string, DemoSavedThread[]>();

const demoAlterId = "11111111-1111-4111-8111-111111111111";
const demoFrontingId = "22222222-2222-4222-8222-222222222222";
const demoSessionId = "33333333-3333-4333-8333-333333333333";

function iso(value: Date | string) {
  return new Date(value).toISOString();
}

function isValidWindow(startAt: Date | string, endAt: Date | string) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

function demoItems(): CatchUpItem[] {
  const base = [
    {
      entryId: "40000000-0000-4000-8000-000000000001",
      itemType: "NOTE" as const,
      itemId: "50000000-0000-4000-8000-000000000001",
      title: "Before the next meeting",
      whyItMatters: "Alex left context for the next stakeholder conversation.",
      fromLabel: "Alex",
      toLabel: "Mouse Arcade",
      timestamp: "2026-09-01T20:15:00.000Z",
      nextAction: "Read the note and decide whether it needs follow-up.",
    },
    {
      entryId: "40000000-0000-4000-8000-000000000002",
      itemType: "TODO" as const,
      itemId: "50000000-0000-4000-8000-000000000002",
      title: "Review connector scope",
      whyItMatters: "This is blocked and due soon, so it carries into this catch-up.",
      fromLabel: "System",
      toLabel: "Mouse Arcade",
      timestamp: "2026-09-01T18:40:00.000Z",
      statusLabel: "Blocked · High priority",
      dueOn: "2026-09-03",
      nextAction: "Choose the connector boundary or defer it with a return time.",
    },
    {
      entryId: "40000000-0000-4000-8000-000000000003",
      itemType: "DECISION" as const,
      itemId: "50000000-0000-4000-8000-000000000003",
      title: "Keep catch-up pull-based",
      whyItMatters: "The daily experience should stay available without interrupting the active chat.",
      fromLabel: "Mouse Arcade",
      toLabel: "System-wide",
      timestamp: "2026-09-01T16:10:00.000Z",
      statusLabel: "Decision record",
      nextAction: "Use this decision as the notification boundary for v1.",
    },
    {
      entryId: "40000000-0000-4000-8000-000000000004",
      itemType: "THREAD" as const,
      itemId: "50000000-0000-4000-8000-000000000004",
      title: "Companion harness and catch-up design",
      whyItMatters: "Contains the approved command-center direction and exact catch-up semantics.",
      fromLabel: "Mouse Arcade",
      toLabel: "Mouse Arcade",
      timestamp: "2026-09-01T14:30:00.000Z",
      statusLabel: "Confirmed thread",
      nextAction: "Open the approved summary when implementation context is needed.",
      threadSource: "CODEX" as const,
      threadUrl: "https://chatgpt.com/",
    },
    {
      entryId: "40000000-0000-4000-8000-000000000005",
      itemType: "THREAD" as const,
      itemId: "50000000-0000-4000-8000-000000000005",
      title: "System command center stakeholder interview",
      whyItMatters: "Captures what should be visible after an alter returns.",
      fromLabel: "Mouse Arcade",
      toLabel: "Mouse Arcade",
      timestamp: "2026-09-01T13:05:00.000Z",
      statusLabel: "Confirmed thread",
      nextAction: "Open the approved summary before changing the information hierarchy.",
      threadSource: "CHATGPT" as const,
      threadUrl: "https://chatgpt.com/",
    },
  ];
  return base.map((item) => ({ ...item, reviewState: "NEW" as const, version: 1 }));
}

const demoSessions = new Map<string, CatchUpSession>();
const demoReceipts = new Map<string, unknown>();

export function getDemoCatchUpSession(ownerId = "demo:catch-up") {
  const existing = demoSessions.get(ownerId);
  if (existing) return existing;
  const items = demoItems();
  const session = catchUpSessionSchema.parse({
    id: demoSessionId,
    alterId: demoAlterId,
    alterName: "Mouse Arcade",
    startedAt: "2026-09-02T13:00:00.000Z",
    windowStart: "2026-08-28T22:15:00.000Z",
    windowEnd: "2026-09-02T13:00:00.000Z",
    firstTime: false,
    items,
    reviewedCount: 0,
    totalCount: items.length,
    stateVersion: 1,
  });
  demoSessions.set(ownerId, session);
  return session;
}

export class CatchUpService {
  constructor(private readonly pool: Pool = getDatabasePool()) {}

  private async ensureOwner(client: PoolClient, ownerId: string) {
    await client.query("insert into app_user (id, google_subject) values ($1, $1) on conflict (id) do nothing", [ownerId]);
  }

  async listThreads(ownerId: string) {
    if (ownerId.startsWith("demo:")) {
      const saved = (demoSavedThreads.get(ownerId) ?? []).map((thread) => ({ ...thread, recipients: thread.recipientAlterIds.map(() => "Linked profile") }));
      return [...saved, ...getDemoCatchUpSession(ownerId).items.filter((item) => item.itemType === "THREAD").map((item) => ({ id: item.itemId, source: item.threadSource, url: item.threadUrl, title: item.title, approvedSummary: item.whyItMatters, keyDecisionOrAction: item.nextAction, flaggedBy: item.fromLabel, recipients: [item.toLabel], status: "CONFIRMED", version: 1, updatedAt: item.timestamp }))];
    }
    const result = await this.pool.query(`select t.id, t.source, t.url, t.title, t.approved_summary as "approvedSummary",
      t.key_decision_or_action as "keyDecisionOrAction", t.status, t.version, t.updated_at as "updatedAt",
      flagger.name as "flaggedBy", coalesce(array_agg(recipient.name order by recipient.name) filter (where recipient.id is not null), '{}') as recipients
      from important_thread t
      left join alter_profile flagger on flagger.owner_id = t.owner_id and flagger.id = t.flagged_by_alter_id
      left join important_thread_recipient tr on tr.owner_id = t.owner_id and tr.thread_id = t.id
      left join alter_profile recipient on recipient.owner_id = tr.owner_id and recipient.id = tr.alter_id
      where t.owner_id = $1 and t.status <> 'ARCHIVED'
      group by t.id, flagger.name order by t.updated_at desc`, [ownerId]);
    return result.rows.map((row) => ({ ...row, updatedAt: iso(row.updatedAt) }));
  }

  async listDecisions(ownerId: string) {
    if (ownerId.startsWith("demo:")) return getDemoCatchUpSession(ownerId).items.filter((item) => item.itemType === "DECISION").map((item) => ({ id: item.itemId, title: item.title, decision: item.whyItMatters, nextAction: item.nextAction, actor: item.fromLabel, recipients: [item.toLabel], version: 1, updatedAt: item.timestamp }));
    const result = await this.pool.query(`select d.id, d.title, d.decision, d.rationale, d.next_action as "nextAction", d.version,
      d.updated_at as "updatedAt", actor.name as actor,
      coalesce(array_agg(recipient.name order by recipient.name) filter (where recipient.id is not null), '{}') as recipients
      from system_decision d
      left join alter_profile actor on actor.owner_id = d.owner_id and actor.id = d.actor_alter_id
      left join system_decision_recipient dr on dr.owner_id = d.owner_id and dr.decision_id = d.id
      left join alter_profile recipient on recipient.owner_id = dr.owner_id and recipient.id = dr.alter_id
      where d.owner_id = $1 and d.archived_at is null
      group by d.id, actor.name order by d.updated_at desc`, [ownerId]);
    return result.rows.map((row) => ({ ...row, updatedAt: iso(row.updatedAt) }));
  }

  async prepareConversationCatchUp(ownerId: string, raw: PrepareConversationCatchUp): Promise<ConversationCatchUpHandoff> {
    const input = prepareConversationCatchUpSchema.parse(raw);
    const instructions = [
      "This handoff does not give System access to ChatGPT conversation history.",
      "Generate the catch-up now in ChatGPT: show the window and elapsedSeconds as a readable duration, then summarize what happened. A capable host may retrieve available conversations in this window, read messages rather than only titles, and report topics, decisions, open matters, source links, and coverage gaps.",
      "If the host cannot retrieve other conversations, say so clearly; do not claim that nothing happened or fabricate a summary.",
      "Keep conversation findings separate from current authenticated facts and real-world completion. After generating the summary, call save_conversation_catch_up with the exact window, alterId, summary and coverage gaps. Retain it for 30 days and reuse its requestId on retries. Never persist raw transcripts.",
    ];
    if (ownerId.startsWith("demo:")) {
      if (input.alterId !== demoAlterId) throw new SystemError("NOT_FOUND", "The alter to catch up was not found or is archived.");
      if (input.startAt && input.endAt) return conversationHandoff({ status: "READY", alterId: demoAlterId, alterName: "Mouse Arcade", historyAccess: "HOST_REQUIRED", window: { startAt: iso(input.startAt), endAt: iso(input.endAt), timeZone: input.timeZone, provenance: "USER_SELECTED" }, instructions });
      const session = getDemoCatchUpSession(ownerId);
      return conversationHandoff({ status: "READY", alterId: demoAlterId, alterName: session.alterName, historyAccess: "HOST_REQUIRED", window: { startAt: session.windowStart!, endAt: session.windowEnd, timeZone: input.timeZone, provenance: "RECORDED_FRONTING_WINDOW" }, source: { frontingSessionId: demoFrontingId, catchUpSessionId: session.id }, instructions });
    }

    const client = await this.pool.connect();
    try {
      const alter = await client.query<{ id: string; name: string }>("select id, name from alter_profile where owner_id = $1 and id = $2::uuid and archived_at is null", [ownerId, input.alterId]);
      if (!alter.rows[0]) throw new SystemError("NOT_FOUND", "The alter to catch up was not found or is archived.");
      const profile = alter.rows[0];
      if (input.startAt && input.endAt) return conversationHandoff({ status: "READY", alterId: profile.id, alterName: profile.name, historyAccess: "HOST_REQUIRED", window: { startAt: iso(input.startAt), endAt: iso(input.endAt), timeZone: input.timeZone, provenance: "USER_SELECTED" }, instructions });

      const typed = input.frontingSessionId ? { rows: [] } : await client.query<{id:string; kind:"HOSTING"|"FRONTING"; started_at:Date|string}>(`select id,kind,started_at from presence_period
        where owner_id=$1 and alter_id=$2::uuid and (($3::uuid is null and ended_at is null) or id=$3::uuid)
        order by started_at desc limit 2`, [ownerId,profile.id,input.periodId??null]);
      if (input.periodId || typed.rows.length) {
        if (typed.rows.length !== 1) return conversationHandoff({status:"NEEDS_DATES",alterId:profile.id,alterName:profile.name,historyAccess:"HOST_REQUIRED",instructions:[...instructions,"Choose one recorded hosting or fronting periodId, or explicit startAt and endAt. No unique period was selected."]});
        const period=typed.rows[0];
        const prior=await client.query<{ended_at:Date|string}>(`select ended_at from presence_period where owner_id=$1 and alter_id=$2::uuid and kind=$3::presence_kind and id<>$5::uuid and ended_at<=$4::timestamptz order by ended_at desc limit 1`,[ownerId,profile.id,period.kind,period.started_at,period.id]);
        const source={presencePeriodId:period.id,kind:period.kind};
        if(!prior.rows[0] || !isValidWindow(prior.rows[0].ended_at, period.started_at))return conversationHandoff({status:"NEEDS_DATES",alterId:profile.id,alterName:profile.name,source,historyAccess:"HOST_REQUIRED",instructions:[...instructions,"No earlier recorded end for this experience kind is available. Choose explicit dates."]});
        return conversationHandoff({status:"READY",alterId:profile.id,alterName:profile.name,historyAccess:"HOST_REQUIRED",source,window:{startAt:iso(prior.rows[0].ended_at),endAt:iso(period.started_at),timeZone:input.timeZone,provenance:"RECORDED_PRESENCE_WINDOW"},instructions});
      }

      const current = await client.query<{ id: string; started_at: Date | string }>("select id, started_at from fronting_session where owner_id = $1 and alter_id = $2::uuid and (($3::uuid is null and ended_at is null) or id=$3::uuid)", [ownerId, profile.id, input.frontingSessionId ?? null]);
      if (!current.rows[0]) return conversationHandoff({ status: "NEEDS_DATES", alterId: profile.id, alterName: profile.name, historyAccess: "HOST_REQUIRED", instructions: [...instructions, "No recorded current fronting window is available for this profile. Ask the user to choose startAt and endAt."] });
      const front = current.rows[0];
      const persisted = await client.query<{ id: string; window_start: Date | string | null; window_end: Date | string }>("select id, window_start, window_end from catch_up_session where owner_id = $1 and fronting_session_id = $2::uuid", [ownerId, front.id]);
      const stored = persisted.rows[0];
      if (stored?.window_start) {
        if (!isValidWindow(stored.window_start, stored.window_end)) return conversationHandoff({ status: "NEEDS_DATES", alterId: profile.id, alterName: profile.name, historyAccess: "HOST_REQUIRED", source: { frontingSessionId: front.id, catchUpSessionId: stored.id }, instructions: [...instructions, "The recorded fronting window is malformed. Ask the user to choose startAt and endAt."] });
        return conversationHandoff({ status: "READY", alterId: profile.id, alterName: profile.name, historyAccess: "HOST_REQUIRED", window: { startAt: iso(stored.window_start), endAt: iso(stored.window_end), timeZone: input.timeZone, provenance: "RECORDED_FRONTING_WINDOW" }, source: { frontingSessionId: front.id, catchUpSessionId: stored.id }, instructions });
      }
      const previous = await client.query<{ ended_at: Date | string }>("select ended_at from fronting_session where owner_id = $1 and alter_id = $2::uuid and id <> $3::uuid and ended_at is not null and ended_at <= $4::timestamptz order by ended_at desc limit 1", [ownerId, profile.id, front.id, front.started_at]);
      if (!previous.rows[0]) return conversationHandoff({ status: "NEEDS_DATES", alterId: profile.id, alterName: profile.name, historyAccess: "HOST_REQUIRED", source: { frontingSessionId: front.id }, instructions: [...instructions, "No earlier recorded fronting end is available for this profile. Ask the user to choose startAt and endAt."] });
      if (!isValidWindow(previous.rows[0].ended_at, front.started_at)) return conversationHandoff({ status: "NEEDS_DATES", alterId: profile.id, alterName: profile.name, historyAccess: "HOST_REQUIRED", source: { frontingSessionId: front.id }, instructions: [...instructions, "The recorded fronting window is malformed. Ask the user to choose startAt and endAt."] });
      return conversationHandoff({ status: "READY", alterId: profile.id, alterName: profile.name, historyAccess: "HOST_REQUIRED", window: { startAt: iso(previous.rows[0].ended_at), endAt: iso(front.started_at), timeZone: input.timeZone, provenance: "RECORDED_FRONTING_WINDOW" }, source: { frontingSessionId: front.id }, instructions });
    } finally { client.release(); }
  }

  async openForCurrentFront(ownerId: string): Promise<CatchUpSession | null> {
    return this.openForSource(ownerId);
  }

  async openForPresence(ownerId: string, periodId?: string): Promise<CatchUpSession | null> {
    if (periodId) uuidSchema.parse(periodId);
    return this.openForSource(ownerId, periodId, true);
  }

  private async openForSource(ownerId: string, periodId?: string, usePresence = false): Promise<CatchUpSession | null> {
    if (ownerId.startsWith("demo:")) return getDemoCatchUpSession(ownerId);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const current = usePresence
        ? await client.query<{ id: string; alter_id: string; alter_name: string; started_at: Date | string; kind?: string }>(`select p.id, p.alter_id, a.name as alter_name, p.started_at, p.kind
            from presence_period p join alter_profile a on a.owner_id=p.owner_id and a.id=p.alter_id
            where p.owner_id=$1 and p.ended_at is null and ($2::uuid is null or p.id=$2::uuid)
            order by p.started_at desc limit 2 for update of p`, [ownerId, periodId ?? null])
        : await client.query<{ id: string; alter_id: string; alter_name: string; started_at: Date | string; kind?: string }>(`select fs.id, fs.alter_id, a.name as alter_name, fs.started_at
            from fronting_session fs join alter_profile a on a.owner_id=fs.owner_id and a.id=fs.alter_id
            where fs.owner_id=$1 and fs.ended_at is null for update of fs`, [ownerId]);
      if (usePresence && current.rows.length > 1) {
        await client.query("commit");
        return null; // Caller must choose a period; do not guess a recipient.
      }
      if (!current.rows[0]) {
        await client.query("commit");
        return null;
      }
      const front = current.rows[0];
      const sourceTable = usePresence ? "presence_period" : "fronting_session";
      const sourceColumn = usePresence ? "presence_period_id" : "fronting_session_id";
      const previous = await client.query<{ ended_at: Date | string }>(`select ended_at from ${sourceTable}
        where owner_id = $1 and alter_id = $2::uuid and id <> $3::uuid and ended_at is not null and ended_at <= $4::timestamptz
        ${usePresence ? "and kind = $5::presence_kind" : ""}
        order by ended_at desc limit 1`, [ownerId, front.alter_id, front.id, front.started_at, ...(usePresence ? [front.kind] : [])]);
      const windowStart = previous.rows[0]?.ended_at ?? null;
      const inserted = await client.query<{ id: string }>(`insert into catch_up_session
        (owner_id, ${sourceColumn}, alter_id, window_start, window_end, first_time)
        values ($1, $2::uuid, $3::uuid, $4::timestamptz, $5::timestamptz, $6)
        on conflict (owner_id, ${sourceColumn}) do update set updated_at = catch_up_session.updated_at
        returning id`, [ownerId, front.id, front.alter_id, windowStart, front.started_at, !windowStart]);
      const sessionId = inserted.rows[0].id;
      const candidates = await this.loadCandidates(client, ownerId, front.alter_id, windowStart, front.started_at);
      for (const candidate of candidates) {
        await client.query(`insert into catch_up_entry (owner_id, session_id, item_type, item_id)
          values ($1, $2::uuid, $3::catch_up_item_type, $4::uuid)
          on conflict (owner_id, session_id, item_type, item_id) do nothing`, [ownerId, sessionId, candidate.itemType, candidate.itemId]);
      }
      const priorCarry = await client.query<{ item_type: CatchUpItemType; item_id: string }>(`select distinct on (ce.item_type, ce.item_id) ce.item_type, ce.item_id
        from catch_up_entry ce join catch_up_session prior on prior.owner_id = ce.owner_id and prior.id = ce.session_id
        where ce.owner_id = $1 and prior.alter_id = $2::uuid and prior.id <> $3::uuid
          and (ce.review_state = 'NEW' or (ce.review_state = 'DEFERRED' and (ce.defer_until_next_switch or ce.defer_until <= now())))
        order by ce.item_type, ce.item_id, ce.updated_at desc`, [ownerId, front.alter_id, sessionId]);
      for (const carry of priorCarry.rows) {
        await client.query(`insert into catch_up_entry (owner_id, session_id, item_type, item_id)
          values ($1, $2::uuid, $3::catch_up_item_type, $4::uuid)
          on conflict (owner_id, session_id, item_type, item_id) do nothing`, [ownerId, sessionId, carry.item_type, carry.item_id]);
      }
      await client.query(`update catch_up_entry set review_state = 'NEW', defer_until = null, defer_until_next_switch = false,
        version = version + 1, updated_at = now()
        where owner_id = $1 and session_id = $2::uuid and review_state = 'DEFERRED' and defer_until <= now()`, [ownerId, sessionId]);
      const result = await this.hydrate(client, ownerId, sessionId, front.alter_name, front.started_at);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async loadCandidates(client: PoolClient, ownerId: string, alterId: string, windowStart: Date | string | null, windowEnd: Date | string): Promise<Candidate[]> {
    const since = windowStart ? iso(windowStart) : null;
    const until = iso(windowEnd);
    const notes = await client.query(`select n.id, n.body, n.created_at, recipient.name as recipient_name,
          coalesce(actor.name, 'System') as actor_name
        from system_note n
        left join alter_profile recipient on recipient.owner_id = n.owner_id and recipient.id = n.alter_id
        left join lateral (
          select ae.actor_alter_id from activity_event ae
          where ae.owner_id = n.owner_id and ae.entity_type = 'NOTE' and ae.entity_id = n.id and ae.actor_alter_id is not null
          order by ae.created_at asc limit 1
        ) note_actor on true
        left join alter_profile actor on actor.owner_id = n.owner_id and actor.id = note_actor.actor_alter_id
        where n.owner_id = $1 and (n.alter_id is null or n.alter_id = $2::uuid)
          and n.created_at <= $4::timestamptz and ($3::timestamptz is null or n.created_at >= $3::timestamptz)`, [ownerId, alterId, since, until]);
    const todos = await client.query(`select t.id, t.title, t.details, t.status, t.priority, t.due_on, t.updated_at,
          coalesce(string_agg(a.name, ', ' order by a.name), 'System-wide') as recipient_names
        from system_todo t
        left join todo_assignee ta on ta.owner_id = t.owner_id and ta.todo_id = t.id
        left join alter_profile a on a.owner_id = ta.owner_id and a.id = ta.alter_id
        where t.owner_id = $1 and t.archived_at is null and t.status not in ('DONE', 'CANCELLED')
          and (ta.alter_id is null or ta.alter_id = $2::uuid)
          and (t.updated_at <= $4::timestamptz and ($3::timestamptz is null or t.updated_at >= $3::timestamptz)
            or t.status = 'BLOCKED' or t.priority = 'HIGH' or (t.due_on is not null and t.due_on <= $4::date))
        group by t.id`, [ownerId, alterId, since, until]);
    const decisions = await client.query(`select d.id, d.title, d.decision, d.next_action, d.updated_at,
          coalesce(actor.name, 'System') as actor_name,
          coalesce(string_agg(recipient.name, ', ' order by recipient.name), 'System-wide') as recipient_names
        from system_decision d
        left join alter_profile actor on actor.owner_id = d.owner_id and actor.id = d.actor_alter_id
        left join system_decision_recipient dr on dr.owner_id = d.owner_id and dr.decision_id = d.id
        left join alter_profile recipient on recipient.owner_id = dr.owner_id and recipient.id = dr.alter_id
        where d.owner_id = $1 and d.archived_at is null and (dr.alter_id is null or dr.alter_id = $2::uuid)
          and d.updated_at <= $4::timestamptz and ($3::timestamptz is null or d.updated_at >= $3::timestamptz)
        group by d.id, actor.name`, [ownerId, alterId, since, until]);
    const threads = await client.query(`select t.id, t.title, t.approved_summary, t.key_decision_or_action, t.source, t.url,
          t.confirmed_at, coalesce(flagger.name, 'System') as flagger_name,
          coalesce(string_agg(recipient.name, ', ' order by recipient.name), 'System-wide') as recipient_names
        from important_thread t
        left join alter_profile flagger on flagger.owner_id = t.owner_id and flagger.id = t.flagged_by_alter_id
        left join important_thread_recipient tr on tr.owner_id = t.owner_id and tr.thread_id = t.id
        left join alter_profile recipient on recipient.owner_id = tr.owner_id and recipient.id = tr.alter_id
        where t.owner_id = $1 and t.status = 'CONFIRMED' and (tr.alter_id is null or tr.alter_id = $2::uuid)
          and t.confirmed_at <= $4::timestamptz and ($3::timestamptz is null or t.confirmed_at >= $3::timestamptz)
        group by t.id, flagger.name`, [ownerId, alterId, since, until]);

    const items: Candidate[] = [];
    for (const row of notes.rows) items.push({ itemType: "NOTE", itemId: row.id, title: String(row.body).split("\n")[0].slice(0, 120), whyItMatters: "A direct note was left for this alter or for the System.", fromLabel: row.actor_name, toLabel: row.recipient_name ?? "System-wide", timestamp: iso(row.created_at), nextAction: "Read the note and decide whether it needs follow-up." });
    for (const row of todos.rows) items.push({ itemType: "TODO", itemId: row.id, title: row.title, whyItMatters: row.status === "BLOCKED" || row.priority === "HIGH" ? "This urgent carryover still needs attention." : "This todo changed during this recorded catch-up window.", fromLabel: "System", toLabel: row.recipient_names, timestamp: iso(row.updated_at), statusLabel: [row.status, row.priority].filter(Boolean).join(" · "), dueOn: row.due_on ? postgresDateOnly(row.due_on) : undefined, nextAction: row.details || "Choose the next action for this todo." });
    for (const row of decisions.rows) items.push({ itemType: "DECISION", itemId: row.id, title: row.title, whyItMatters: row.decision, fromLabel: row.actor_name, toLabel: row.recipient_names, timestamp: iso(row.updated_at), statusLabel: "Decision record", nextAction: row.next_action });
    for (const row of threads.rows) items.push({ itemType: "THREAD", itemId: row.id, title: row.title, whyItMatters: row.approved_summary, fromLabel: row.flagger_name, toLabel: row.recipient_names, timestamp: iso(row.confirmed_at), statusLabel: "Confirmed thread", nextAction: row.key_decision_or_action, threadSource: row.source, threadUrl: row.url });
    return items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  private async hydrate(client: PoolClient, ownerId: string, sessionId: string, alterName: string, startedAt: Date | string, candidates?: Candidate[]) {
    const session = await client.query<{ id: string; alter_id: string; window_start: Date | string | null; window_end: Date | string; first_time: boolean; presence_period_id: string | null; kind: "HOSTING" | "FRONTING" | null }>("select cs.id, cs.alter_id, cs.window_start, cs.window_end, cs.first_time, cs.presence_period_id, p.kind from catch_up_session cs left join presence_period p on p.owner_id=cs.owner_id and p.id=cs.presence_period_id where cs.owner_id = $1 and cs.id = $2::uuid", [ownerId, sessionId]);
    const row = session.rows[0];
    if (!row) throw new SystemError("NOT_FOUND", "Catch-up session not found.");
    const entries = await client.query<EntryRow>("select id, item_type, item_id, review_state, defer_until, defer_until_next_switch, version from catch_up_entry where owner_id = $1 and session_id = $2::uuid order by created_at", [ownerId, sessionId]);
    const sourceItems = candidates ?? await this.loadCandidates(client, ownerId, row.alter_id, null, row.window_end);
    const byKey = new Map(sourceItems.map((item) => [`${item.itemType}:${item.itemId}`, item]));
    const items = entries.rows.flatMap((entry) => {
      const candidate = byKey.get(`${entry.item_type}:${entry.item_id}`);
      return candidate ? [{ ...candidate, entryId: entry.id, reviewState: entry.review_state, deferUntil: entry.defer_until ? iso(entry.defer_until) : undefined, deferUntilNextSwitch: entry.defer_until_next_switch || undefined, version: entry.version }] : [];
    });
    const reviewedCount = items.filter((item) => item.reviewState !== "NEW").length;
    return catchUpSessionSchema.parse({ presencePeriodId: row.presence_period_id ?? undefined, sourceKind: row.kind ?? "LEGACY_FRONT", id: row.id, alterId: row.alter_id, alterName, startedAt: iso(startedAt), windowStart: row.window_start ? iso(row.window_start) : undefined, windowEnd: iso(row.window_end), firstTime: row.first_time, items, reviewedCount, totalCount: items.length, stateVersion: entries.rows.reduce((sum, entry) => sum + entry.version, 0) });
  }

  async setItemState(ownerId: string, entryId: string, raw: SetCatchUpItemState, source: RecordSource) {
    const input = setCatchUpItemStateSchema.parse(raw);
    if (ownerId.startsWith("demo:")) {
      const receiptKey = `${ownerId}:${input.requestId}`;
      if (demoReceipts.has(receiptKey)) return { data: demoReceipts.get(receiptKey) as CatchUpSession, replayed: true };
      const current = getDemoCatchUpSession(ownerId);
      const item = current.items.find((candidate) => candidate.entryId === entryId);
      if (!item) throw new SystemError("NOT_FOUND", "Catch-up item not found.");
      if (item.version !== input.expectedVersion) throw new SystemError("CONFLICT", "The catch-up item changed since it was read.", { currentVersion: item.version });
      item.reviewState = input.state;
      item.deferUntil = input.state === "DEFERRED" ? input.deferUntil : undefined;
      item.deferUntilNextSwitch = input.state === "DEFERRED" ? input.deferUntilNextSwitch : undefined;
      item.version += 1;
      current.reviewedCount = current.items.filter((candidate) => candidate.reviewState !== "NEW").length;
      current.stateVersion += 1;
      demoReceipts.set(receiptKey, current);
      return { data: current, replayed: false };
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ownerId}:${input.requestId}`]);
      const prior = await client.query<{ operation: string; result: CatchUpSession }>("select operation, result from mutation_receipt where owner_id = $1 and request_id = $2::uuid", [ownerId, input.requestId]);
      const operation = `set_catch_up_item_state:${entryId}`;
      if (prior.rows[0]) {
        if (prior.rows[0].operation !== operation) throw new SystemError("CONFLICT", "This requestId was already used for a different operation.");
        await client.query("commit");
        return { data: prior.rows[0].result, replayed: true };
      }
      const updated = await client.query<{ session_id: string }>(`update catch_up_entry set review_state = $3::catch_up_review_state,
        defer_until = $4::timestamptz, defer_until_next_switch = $5, version = version + 1, updated_at = now()
        where owner_id = $1 and id = $2::uuid and version = $6 returning session_id`, [ownerId, entryId, input.state, input.state === "DEFERRED" ? input.deferUntil : null, input.state === "DEFERRED" && input.deferUntilNextSwitch === true, input.expectedVersion]);
      if (!updated.rows[0]) throw new SystemError("CONFLICT", "The catch-up item changed since it was read.");
      const context = await client.query<{ alter_name: string; started_at: Date | string }>(`select a.name as alter_name, coalesce(p.started_at, fs.started_at) as started_at from catch_up_session cs
        join alter_profile a on a.owner_id = cs.owner_id and a.id = cs.alter_id
        left join fronting_session fs on fs.owner_id = cs.owner_id and fs.id = cs.fronting_session_id
        left join presence_period p on p.owner_id = cs.owner_id and p.id = cs.presence_period_id
        where cs.owner_id = $1 and cs.id = $2::uuid`, [ownerId, updated.rows[0].session_id]);
      const data = await this.hydrate(client, ownerId, updated.rows[0].session_id, context.rows[0].alter_name, context.rows[0].started_at);
      await client.query("insert into mutation_receipt (owner_id, request_id, operation, result) values ($1, $2::uuid, $3, $4::jsonb)", [ownerId, input.requestId, operation, JSON.stringify(data)]);
      await client.query(`insert into activity_event (owner_id, entity_type, entity_id, action, source, changed_fields, request_id, to_status)
        values ($1, 'CATCH_UP_ENTRY', $2::uuid, 'REVIEW_STATE_SET', $3::record_source, array['reviewState','deferUntil'], $4::uuid, $5)`, [ownerId, entryId, source, input.requestId, input.state]);
      await client.query("commit");
      return { data, replayed: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
  }

  async suggestThread(ownerId: string, raw: ImportantThreadCreate, source: RecordSource) {
    const input = importantThreadCreateSchema.parse(raw);
    if (ownerId.startsWith("demo:")) {
      const key = `${ownerId}:${input.requestId}`;
      const prior = demoReceipts.get(key);
      if (prior) return { data: prior, replayed: true };
      const data = { id: randomUUID(), ...input, status: "SUGGESTED" as const, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      demoSavedThreads.set(ownerId, [structuredClone(data), ...(demoSavedThreads.get(ownerId) ?? [])]);
      demoReceipts.set(key, data);
      return { data, replayed: false };
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.ensureOwner(client, ownerId);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ownerId}:${input.requestId}`]);
      const prior = await client.query<{ operation: string; result: unknown }>("select operation, result from mutation_receipt where owner_id = $1 and request_id = $2::uuid", [ownerId, input.requestId]);
      if (prior.rows[0]) {
        if (prior.rows[0].operation !== "suggest_important_thread") throw new SystemError("CONFLICT", "This requestId was already used for a different operation.");
        await client.query("commit");
        return { data: prior.rows[0].result, replayed: true };
      }
      const inserted = await client.query<{ id: string }>(`insert into important_thread
        (owner_id, source, external_thread_id, url, title, approved_summary, key_decision_or_action, flagged_by_alter_id)
        values ($1, $2::important_thread_source, $3, $4, $5, $6, $7, $8::uuid) returning id`, [ownerId, input.source, input.externalThreadId, input.url, input.title, input.approvedSummary, input.keyDecisionOrAction, input.flaggedByAlterId ?? null]);
      for (const recipient of input.recipientAlterIds) await client.query("insert into important_thread_recipient (owner_id, thread_id, alter_id) values ($1, $2::uuid, $3::uuid)", [ownerId, inserted.rows[0].id, recipient]);
      const data = { id: inserted.rows[0].id, ...input, status: "SUGGESTED" as const, version: 1, createdAt: new Date().toISOString() };
      await client.query(`insert into activity_event (owner_id, entity_type, entity_id, action, source, changed_fields, request_id)
        values ($1, 'THREAD', $2::uuid, 'SUGGESTED', $3::record_source, array['approvedSummary','keyDecisionOrAction'], $4::uuid)`, [ownerId, inserted.rows[0].id, source, input.requestId]);
      await client.query("insert into mutation_receipt (owner_id, request_id, operation, result) values ($1, $2::uuid, 'suggest_important_thread', $3::jsonb)", [ownerId, input.requestId, JSON.stringify(data)]);
      await client.query("commit");
      return { data, replayed: false };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async confirmThread(ownerId: string, threadId: string, expectedVersion: number, requestId: string, source: RecordSource) {
    if (ownerId.startsWith("demo:")) {
      const key = `${ownerId}:${requestId}`;
      const prior = demoReceipts.get(key);
      if (prior) return { data: prior, replayed: true };
      const thread = (demoSavedThreads.get(ownerId) ?? []).find((item) => item.id === threadId);
      if (!thread) throw new SystemError("NOT_FOUND", "Thread not found.");
      if (thread.version !== expectedVersion) throw new SystemError("CONFLICT", "Thread changed. Reload before confirming.");
      thread.status = "CONFIRMED";
      thread.version += 1;
      thread.updatedAt = new Date().toISOString();
      const data = { id: threadId, status: "CONFIRMED" as const, version: thread.version };
      demoReceipts.set(key, data);
      return { data, replayed: false };
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ownerId}:${requestId}`]);
      const prior = await client.query<{ operation: string; result: unknown }>("select operation, result from mutation_receipt where owner_id = $1 and request_id = $2::uuid", [ownerId, requestId]);
      const operation = `confirm_important_thread:${threadId}`;
      if (prior.rows[0]) {
        if (prior.rows[0].operation !== operation) throw new SystemError("CONFLICT", "This requestId was already used for a different operation.");
        await client.query("commit");
        return { data: prior.rows[0].result, replayed: true };
      }
      const result = await client.query<{ id: string; version: number }>(`update important_thread set status = 'CONFIRMED', confirmed_at = now(), updated_at = now(), version = version + 1
        where owner_id = $1 and id = $2::uuid and status = 'SUGGESTED' and version = $3 returning id, version`, [ownerId, threadId, expectedVersion]);
      if (!result.rows[0]) throw new SystemError("CONFLICT", "The thread suggestion changed since it was read.");
      const data = { ...result.rows[0], status: "CONFIRMED" as const };
      await client.query(`insert into activity_event (owner_id, entity_type, entity_id, action, source, changed_fields, request_id, to_status)
        values ($1, 'THREAD', $2::uuid, 'CONFIRMED', $3::record_source, array['status'], $4::uuid, 'CONFIRMED')`, [ownerId, threadId, source, requestId]);
      await client.query("insert into mutation_receipt (owner_id, request_id, operation, result) values ($1, $2::uuid, $3, $4::jsonb)", [ownerId, requestId, operation, JSON.stringify(data)]);
      await client.query("commit");
      return { data, replayed: false };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async createDecision(ownerId: string, raw: SystemDecisionCreate, source: RecordSource) {
    const input = systemDecisionCreateSchema.parse(raw);
    if (ownerId.startsWith("demo:")) {
      const key = `${ownerId}:${input.requestId}`;
      const prior = demoReceipts.get(key);
      if (prior) return { data: prior, replayed: true };
      const data = { id: randomUUID(), ...input, version: 1, createdAt: new Date().toISOString() };
      demoReceipts.set(key, data);
      return { data, replayed: false };
    }
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await this.ensureOwner(client, ownerId);
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ownerId}:${input.requestId}`]);
      const prior = await client.query<{ operation: string; result: unknown }>("select operation, result from mutation_receipt where owner_id = $1 and request_id = $2::uuid", [ownerId, input.requestId]);
      if (prior.rows[0]) {
        if (prior.rows[0].operation !== "create_system_decision") throw new SystemError("CONFLICT", "This requestId was already used for a different operation.");
        await client.query("commit");
        return { data: prior.rows[0].result, replayed: true };
      }
      const inserted = await client.query<{ id: string }>(`insert into system_decision
        (owner_id, title, decision, rationale, next_action, actor_alter_id)
        values ($1, $2, $3, $4, $5, $6::uuid) returning id`, [ownerId, input.title, input.decision, input.rationale ?? null, input.nextAction, input.actorAlterId ?? null]);
      for (const recipient of input.recipientAlterIds) await client.query("insert into system_decision_recipient (owner_id, decision_id, alter_id) values ($1, $2::uuid, $3::uuid)", [ownerId, inserted.rows[0].id, recipient]);
      const data = { id: inserted.rows[0].id, ...input, version: 1, createdAt: new Date().toISOString() };
      await client.query(`insert into activity_event (owner_id, entity_type, entity_id, action, source, changed_fields, request_id, actor_alter_id)
        values ($1, 'DECISION', $2::uuid, 'CREATED', $3::record_source, array['decision','nextAction'], $4::uuid, $5::uuid)`, [ownerId, inserted.rows[0].id, source, input.requestId, input.actorAlterId ?? null]);
      await client.query("insert into mutation_receipt (owner_id, request_id, operation, result) values ($1, $2::uuid, 'create_system_decision', $3::jsonb)", [ownerId, input.requestId, JSON.stringify(data)]);
      await client.query("commit");
      return { data, replayed: false };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }
}

let singleton: CatchUpService | undefined;
export function getCatchUpService() {
  singleton ??= new CatchUpService();
  return singleton;
}
