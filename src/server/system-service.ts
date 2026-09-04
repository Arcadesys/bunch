import { createHmac, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import {
  alterCreateSchema,
  alterPatchSchema,
  eraseAlterSchema,
  frontingSwitchSchema,
  listAltersSchema,
  listNotesSchema,
  listTodosSchema,
  noteCreateSchema,
  todoCreateSchema,
  todoPatchSchema,
  versionMutationSchema,
  type AlterCreate,
  type AlterPatch,
  type AlterView,
  type FrontingSessionView,
  type FrontingSwitch,
  type ListAltersInput,
  type ListNotesInput,
  type ListTodosInput,
  type NoteCreate,
  type NoteView,
  type RecordSource,
  type TodoCreate,
  type TodoPatch,
  type TodoView,
} from "@/domain/contracts";
import { getDatabasePool } from "@/db/client";
import { deletePrivateImages } from "@/server/private-images";
import { SystemError } from "@/server/system-error";

type MutationResult<T> = { data: T; replayed: boolean };
type Page<T> = { data: T[]; nextCursor?: string };
type ErasureCounts = { todos: number; notes: number; coverage: number; images: number };
type ErasurePreview = { alterId: string; version: number; blockers: ErasureCounts; canErase: boolean; previewToken?: string; expiresAt?: string };

type AlterRow = QueryResultRow & {
  id: string;
  name: string;
  aliases: string[] | null;
  pronouns: string | null;
  self_described_gender: string | null;
  description: string | null;
  communication_guidance: string | null;
  strengths: string[];
  boundaries: string[];
  image_count: string | number;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
};

type TodoRow = QueryResultRow & {
  id: string;
  title: string;
  details: string | null;
  status: TodoView["status"];
  due_on: string | null;
  priority: TodoView["priority"] | null;
  assignee_alter_ids: string[] | null;
  coverage_id: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
};

type FrontingRow = QueryResultRow & {
  id: string;
  alter_id: string;
  alter_name: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  version: number;
};

type NoteRow = QueryResultRow & {
  id: string;
  body: string;
  alter_id: string | null;
  alter_name: string | null;
  coverage_id: string | null;
  actor_alter_id: string | null;
  actor_alter_name: string | null;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const alterSelect = `select a.id, a.name, a.pronouns, a.self_described_gender, a.description,
  a.communication_guidance, a.strengths, a.boundaries, a.version, a.created_at, a.updated_at, a.archived_at,
  coalesce((select array_agg(aa.alias order by aa.normalized_alias) from alter_alias aa
    where aa.owner_id = a.owner_id and aa.alter_id = a.id), '{}') as aliases,
  (select count(*) from private_image pi where pi.owner_id = a.owner_id and pi.alter_id = a.id) as image_count
  from alter_profile a`;

const todoSelect = `select t.id, t.title, t.details, t.status, t.due_on, t.priority, t.coverage_id,
  t.version, t.created_at, t.updated_at, t.archived_at,
  coalesce((select array_agg(ta.alter_id order by ta.alter_id) from todo_assignee ta
    where ta.owner_id = t.owner_id and ta.todo_id = t.id), '{}') as assignee_alter_ids
  from system_todo t`;

const noteSelect = `select n.id, n.body, n.alter_id, recipient.name as alter_name, n.coverage_id,
  created_actor.actor_alter_id, actor.name as actor_alter_name,
  n.version, n.created_at, n.updated_at
  from system_note n
  left join alter_profile recipient on recipient.owner_id = n.owner_id and recipient.id = n.alter_id
  left join lateral (
    select ae.actor_alter_id from activity_event ae
    where ae.owner_id = n.owner_id and ae.entity_type = 'NOTE' and ae.entity_id = n.id and ae.action = 'CREATED'
    order by ae.created_at asc limit 1
  ) created_actor on true
  left join alter_profile actor on actor.owner_id = n.owner_id and actor.id = created_actor.actor_alter_id`;

function asIso(value: Date | string) {
  return new Date(value).toISOString();
}

function alterFromRow(row: AlterRow): AlterView {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases ?? [],
    pronouns: row.pronouns ?? undefined,
    selfDescribedGender: row.self_described_gender ?? undefined,
    description: row.description ?? undefined,
    communicationGuidance: row.communication_guidance ?? undefined,
    strengths: row.strengths ?? [],
    boundaries: row.boundaries ?? [],
    imageCount: Number(row.image_count),
    version: row.version,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    archivedAt: row.archived_at ? asIso(row.archived_at) : undefined,
  };
}

function todoFromRow(row: TodoRow): TodoView {
  return {
    id: row.id,
    title: row.title,
    details: row.details ?? undefined,
    status: row.status,
    dueOn: row.due_on ? String(row.due_on).slice(0, 10) : undefined,
    priority: row.priority ?? undefined,
    assigneeAlterIds: row.assignee_alter_ids ?? [],
    coverageId: row.coverage_id ?? undefined,
    version: row.version,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    archivedAt: row.archived_at ? asIso(row.archived_at) : undefined,
  };
}

function frontingFromRow(row: FrontingRow): FrontingSessionView {
  return {
    id: row.id,
    alterId: row.alter_id,
    alterName: row.alter_name,
    startedAt: asIso(row.started_at),
    endedAt: row.ended_at ? asIso(row.ended_at) : undefined,
    version: row.version,
  };
}

function noteFromRow(row: NoteRow): NoteView {
  return {
    id: row.id,
    body: row.body,
    alterId: row.alter_id ?? undefined,
    alterName: row.alter_name ?? undefined,
    coverageId: row.coverage_id ?? undefined,
    actorAlterId: row.actor_alter_id ?? undefined,
    actorAlterName: row.actor_alter_name ?? undefined,
    version: row.version,
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
  };
}

function normalizeAliases(aliases: string[] | undefined) {
  const byNormalized = new Map<string, string>();
  for (const alias of aliases ?? []) {
    const clean = alias.trim();
    const normalized = clean.normalize("NFKC").toLocaleLowerCase("en-US");
    if (normalized) byNormalized.set(normalized, clean);
  }
  return [...byNormalized].map(([normalized, alias]) => ({ alias, normalized }));
}

function encodeCursor(item: { createdAt: string; id: string }) {
  return Buffer.from(JSON.stringify(item), "utf8").toString("base64url");
}

function decodeCursor(cursor: string) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof value.createdAt !== "string" || typeof value.id !== "string") throw new Error();
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new SystemError("VALIDATION_ERROR", "The pagination cursor is invalid.");
  }
}

function erasureSecret() {
  const value = process.env.ERASURE_TOKEN_SIGNING_SECRET ?? process.env.MCP_TOKEN_SIGNING_SECRET;
  if (!value) throw new Error("ERASURE_TOKEN_SIGNING_SECRET is not configured.");
  return value;
}

function issuePreviewToken(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", erasureSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function readPreviewToken(token: string) {
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) throw new SystemError("VALIDATION_ERROR", "The erasure preview token is invalid.");
  const expected = createHmac("sha256", erasureSecret()).update(encoded).digest();
  const actual = Buffer.from(supplied, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new SystemError("VALIDATION_ERROR", "The erasure preview token is invalid.");
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { ownerId: string; alterId: string; version: number; blockers: ErasureCounts; expiresAt: number };
  } catch {
    throw new SystemError("VALIDATION_ERROR", "The erasure preview token is invalid.");
  }
}

export class SystemService {
  constructor(
    private readonly pool: Pool = getDatabasePool(),
    private readonly removePrivateImages: (storageKeys: string[]) => Promise<void> = deletePrivateImages,
  ) {}

  private async ensureOwner(client: PoolClient, ownerId: string) {
    await client.query("insert into app_user (id, google_subject) values ($1, $1) on conflict (id) do nothing", [ownerId]);
  }

  private async activity(client: PoolClient, ownerId: string, entityType: string, entityId: string, action: string, source: RecordSource, changedFields: string[], requestId?: string, fromStatus?: string, toStatus?: string, actorAlterId?: string) {
    await client.query(`insert into activity_event
      (owner_id, entity_type, entity_id, action, source, changed_fields, request_id, from_status, to_status, actor_alter_id)
      values ($1, $2, $3::uuid, $4, $5::record_source, $6::text[], $7::uuid, $8, $9, $10::uuid)`,
    [ownerId, entityType, entityId, action, source, changedFields, requestId ?? null, fromStatus ?? null, toStatus ?? null, actorAlterId ?? null]);
  }

  private async mutate<T>(ownerId: string, requestId: string, operation: string, run: (client: PoolClient) => Promise<T>): Promise<MutationResult<T>> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`${ownerId}:${requestId}`]);
      await this.ensureOwner(client, ownerId);
      const receipt = await client.query<{ operation: string; result: T }>("select operation, result from mutation_receipt where owner_id = $1 and request_id = $2::uuid", [ownerId, requestId]);
      if (receipt.rows[0]) {
        if (receipt.rows[0].operation !== operation) throw new SystemError("CONFLICT", "This requestId was already used for a different operation.");
        await client.query("commit");
        return { data: receipt.rows[0].result, replayed: true };
      }
      const result = JSON.parse(JSON.stringify(await run(client))) as T;
      await client.query("insert into mutation_receipt (owner_id, request_id, operation, result) values ($1, $2::uuid, $3, $4::jsonb)", [ownerId, requestId, operation, JSON.stringify(result)]);
      await client.query("commit");
      return { data: result, replayed: false };
    } catch (error) {
      await client.query("rollback");
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new SystemError("VALIDATION_ERROR", "An alias or identifier is already in use for this owner.");
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async alterById(client: PoolClient, ownerId: string, alterId: string, includeArchived = true) {
    const row = await client.query<AlterRow>(`${alterSelect} where a.owner_id = $1 and a.id = $2::uuid ${includeArchived ? "" : "and a.archived_at is null"}`, [ownerId, alterId]);
    if (!row.rows[0]) throw new SystemError("NOT_FOUND", "Alter not found.");
    return alterFromRow(row.rows[0]);
  }

  async getAlter(ownerId: string, alterId: string, includeArchived = false) {
    const client = await this.pool.connect();
    try { return await this.alterById(client, ownerId, alterId, includeArchived); } finally { client.release(); }
  }

  async listAlters(ownerId: string, raw: ListAltersInput = {}): Promise<Page<AlterView>> {
    const input = listAltersSchema.parse(raw);
    const values: unknown[] = [ownerId];
    const where = ["a.owner_id = $1"];
    if (!input.includeArchived) where.push("a.archived_at is null");
    if (input.search) {
      values.push(`%${input.search}%`);
      where.push(`(a.name ilike $${values.length} or exists (select 1 from alter_alias search_alias where search_alias.owner_id = a.owner_id and search_alias.alter_id = a.id and search_alias.alias ilike $${values.length}))`);
    }
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      values.push(cursor.createdAt, cursor.id);
      where.push(`(a.created_at, a.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(input.limit + 1);
    const rows = await this.pool.query<AlterRow>(`${alterSelect} where ${where.join(" and ")} order by a.created_at desc, a.id desc limit $${values.length}`, values);
    const all = rows.rows.map(alterFromRow);
    const data = all.slice(0, input.limit);
    return { data, nextCursor: all.length > input.limit ? encodeCursor(data[data.length - 1]) : undefined };
  }

  async createAlter(ownerId: string, raw: AlterCreate, source: RecordSource) {
    const input = alterCreateSchema.parse(raw);
    return this.mutate(ownerId, input.requestId, "create_alter", async (client) => {
      const inserted = await client.query<{ id: string }>(`insert into alter_profile
        (owner_id, name, pronouns, self_described_gender, description, communication_guidance, strengths, boundaries)
        values ($1, $2, $3, $4, $5, $6, $7::text[], $8::text[]) returning id`,
      [ownerId, input.name, input.pronouns ?? null, input.selfDescribedGender ?? null, input.description ?? null, input.communicationGuidance ?? null, input.strengths ?? [], input.boundaries ?? []]);
      const alterId = inserted.rows[0].id;
      for (const item of normalizeAliases(input.aliases)) {
        await client.query("insert into alter_alias (owner_id, alter_id, alias, normalized_alias) values ($1, $2::uuid, $3, $4)", [ownerId, alterId, item.alias, item.normalized]);
      }
      const changed = Object.keys(input).filter((key) => key !== "requestId");
      await this.activity(client, ownerId, "ALTER", alterId, "CREATED", source, changed, input.requestId);
      return this.alterById(client, ownerId, alterId);
    });
  }

  private async currentFront(client: PoolClient, ownerId: string, lock = false) {
    const result = await client.query<FrontingRow>(`select fs.id, fs.alter_id, a.name as alter_name,
      fs.started_at, fs.ended_at, fs.version
      from fronting_session fs
      join alter_profile a on a.owner_id = fs.owner_id and a.id = fs.alter_id
      where fs.owner_id = $1 and fs.ended_at is null
      ${lock ? "for update of fs" : ""}`, [ownerId]);
    return result.rows[0] ? frontingFromRow(result.rows[0]) : null;
  }

  async getCurrentFront(ownerId: string) {
    const client = await this.pool.connect();
    try { return await this.currentFront(client, ownerId); } finally { client.release(); }
  }

  async switchCurrentFront(ownerId: string, raw: FrontingSwitch, source: RecordSource) {
    const input = frontingSwitchSchema.parse(raw);
    return this.mutate(ownerId, input.requestId, "switch_current_front", async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`fronting:${ownerId}`]);
      const target = await client.query<{ name: string }>(`select name from alter_profile
        where owner_id = $1 and id = $2::uuid and archived_at is null`, [ownerId, input.alterId]);
      if (!target.rows[0]) throw new SystemError("NOT_FOUND", "The alter to front was not found or is archived.");

      const current = await this.currentFront(client, ownerId, true);
      const currentVersion = current?.version ?? null;
      if (input.expectedCurrentVersion !== currentVersion
        || (input.expectedCurrentSessionId !== undefined && input.expectedCurrentSessionId !== (current?.id ?? null))) {
        throw new SystemError("CONFLICT", "The current front changed since it was read.", { currentVersion });
      }
      if (current?.alterId === input.alterId) return { current, previous: null };

      const switchedAt = input.switchedAt ?? new Date().toISOString();
      if (current && new Date(switchedAt).getTime() < new Date(current.startedAt).getTime()) {
        throw new SystemError("VALIDATION_ERROR", "The switch time cannot be before the current front started.");
      }

      let previous: FrontingSessionView | null = null;
      if (current) {
        const closed = await client.query(`update fronting_session set ended_at = $4::timestamptz,
          version = version + 1, updated_at = now()
          where owner_id = $1 and id = $2::uuid and version = $3`,
        [ownerId, current.id, current.version, switchedAt]);
        if (!closed.rowCount) throw new SystemError("CONFLICT", "The current front changed during the handoff.", { currentVersion: current.version });
        previous = { ...current, endedAt: asIso(switchedAt), version: current.version + 1 };
        await this.activity(client, ownerId, "FRONTING_SESSION", current.id, "ENDED", source, ["endedAt", "version"], input.requestId);
      }

      const inserted = await client.query<FrontingRow>(`with created as (
          insert into fronting_session (owner_id, alter_id, started_at)
          values ($1, $2::uuid, $3::timestamptz)
          returning id, owner_id, alter_id, started_at, ended_at, version
        )
        select c.id, c.alter_id, a.name as alter_name, c.started_at, c.ended_at, c.version
        from created c join alter_profile a on a.owner_id = c.owner_id and a.id = c.alter_id`,
      [ownerId, input.alterId, switchedAt]);
      const next = frontingFromRow(inserted.rows[0]);
      await this.activity(client, ownerId, "FRONTING_SESSION", next.id, "STARTED", source, ["alterId", "startedAt"], input.requestId);
      return { current: next, previous };
    });
  }

  private async noteById(client: PoolClient, ownerId: string, noteId: string) {
    const result = await client.query<NoteRow>(`${noteSelect} where n.owner_id = $1 and n.id = $2::uuid`, [ownerId, noteId]);
    if (!result.rows[0]) throw new SystemError("NOT_FOUND", "Note not found.");
    return noteFromRow(result.rows[0]);
  }

  async listNotes(ownerId: string, raw: ListNotesInput = {}): Promise<Page<NoteView>> {
    const input = listNotesSchema.parse(raw);
    const values: unknown[] = [ownerId];
    const where = ["n.owner_id = $1"];
    if (input.alterId) {
      values.push(input.alterId);
      where.push(`n.alter_id = $${values.length}::uuid`);
    }
    if (input.actorAlterId) {
      values.push(input.actorAlterId);
      where.push(`created_actor.actor_alter_id = $${values.length}::uuid`);
    }
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      values.push(cursor.createdAt, cursor.id);
      where.push(`(n.created_at, n.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(input.limit + 1);
    const rows = await this.pool.query<NoteRow>(`${noteSelect} where ${where.join(" and ")} order by n.created_at desc, n.id desc limit $${values.length}`, values);
    const all = rows.rows.map(noteFromRow);
    const data = all.slice(0, input.limit);
    return { data, nextCursor: all.length > input.limit ? encodeCursor(data[data.length - 1]) : undefined };
  }

  async createNote(ownerId: string, raw: NoteCreate, source: RecordSource) {
    const input = noteCreateSchema.parse(raw);
    return this.mutate(ownerId, input.requestId, "create_system_note", async (client) => {
      const alterIds = [...new Set([input.alterId, input.actorAlterId].filter((value): value is string => Boolean(value)))];
      if (alterIds.length) {
        const found = await client.query<{ id: string }>(`select id from alter_profile
          where owner_id = $1 and id = any($2::uuid[]) and archived_at is null`, [ownerId, alterIds]);
        if (found.rowCount !== alterIds.length) throw new SystemError("VALIDATION_ERROR", "A linked alter was not found or is archived.");
      }
      if (input.coverageId) {
        const coverage = await client.query("select 1 from coverage_assignment where owner_id = $1 and id = $2::uuid", [ownerId, input.coverageId]);
        if (!coverage.rowCount) throw new SystemError("VALIDATION_ERROR", "The coverage record does not belong to this owner.");
      }
      const inserted = await client.query<{ id: string }>(`insert into system_note (owner_id, body, alter_id, coverage_id)
        values ($1, $2, $3::uuid, $4::uuid) returning id`, [ownerId, input.body, input.alterId ?? null, input.coverageId ?? null]);
      const noteId = inserted.rows[0].id;
      await this.activity(client, ownerId, "NOTE", noteId, "CREATED", source, Object.keys(input).filter((key) => key !== "requestId"), input.requestId, undefined, undefined, input.actorAlterId);
      return this.noteById(client, ownerId, noteId);
    });
  }

  async updateAlter(ownerId: string, alterId: string, raw: AlterPatch, source: RecordSource) {
    const input = alterPatchSchema.parse(raw);
    return this.mutate(ownerId, input.requestId, `update_alter:${alterId}`, async (client) => {
      const current = await this.alterById(client, ownerId, alterId);
      if (current.version !== input.expectedVersion) throw new SystemError("CONFLICT", "The alter changed since it was read.", { currentVersion: current.version });
      const changed = Object.keys(input).filter((key) => !["requestId", "expectedVersion"].includes(key));
      const updated = await client.query(`update alter_profile set
        name = $3, pronouns = $4, self_described_gender = $5, description = $6,
        communication_guidance = $7, strengths = $8::text[], boundaries = $9::text[],
        version = version + 1, updated_at = now()
        where owner_id = $1 and id = $2::uuid and version = $10`, [
        ownerId, alterId,
        input.name ?? current.name,
        input.pronouns === undefined ? current.pronouns ?? null : input.pronouns,
        input.selfDescribedGender === undefined ? current.selfDescribedGender ?? null : input.selfDescribedGender,
        input.description === undefined ? current.description ?? null : input.description,
        input.communicationGuidance === undefined ? current.communicationGuidance ?? null : input.communicationGuidance,
        input.strengths ?? current.strengths,
        input.boundaries ?? current.boundaries,
        input.expectedVersion,
      ]);
      if (!updated.rowCount) {
        const latest = await this.alterById(client, ownerId, alterId);
        throw new SystemError("CONFLICT", "The alter changed since it was read.", { currentVersion: latest.version });
      }
      if (input.aliases) {
        await client.query("delete from alter_alias where owner_id = $1 and alter_id = $2::uuid", [ownerId, alterId]);
        for (const item of normalizeAliases(input.aliases)) await client.query("insert into alter_alias (owner_id, alter_id, alias, normalized_alias) values ($1, $2::uuid, $3, $4)", [ownerId, alterId, item.alias, item.normalized]);
      }
      await this.activity(client, ownerId, "ALTER", alterId, "UPDATED", source, changed, input.requestId);
      return this.alterById(client, ownerId, alterId);
    });
  }

  private async setAlterArchive(ownerId: string, alterId: string, raw: { requestId: string; expectedVersion: number }, source: RecordSource, archived: boolean) {
    const input = versionMutationSchema.parse(raw);
    const verb = archived ? "archive" : "restore";
    return this.mutate(ownerId, input.requestId, `${verb}_alter:${alterId}`, async (client) => {
      const result = await client.query(`update alter_profile set archived_at = ${archived ? "now()" : "null"}, version = version + 1, updated_at = now()
        where owner_id = $1 and id = $2::uuid and version = $3`, [ownerId, alterId, input.expectedVersion]);
      if (!result.rowCount) await this.throwVersionOrNotFound(client, "alter_profile", ownerId, alterId);
      await this.activity(client, ownerId, "ALTER", alterId, archived ? "ARCHIVED" : "RESTORED", source, ["archivedAt"], input.requestId);
      return this.alterById(client, ownerId, alterId);
    });
  }

  archiveAlter(ownerId: string, alterId: string, input: { requestId: string; expectedVersion: number }, source: RecordSource) { return this.setAlterArchive(ownerId, alterId, input, source, true); }
  restoreAlter(ownerId: string, alterId: string, input: { requestId: string; expectedVersion: number }, source: RecordSource) { return this.setAlterArchive(ownerId, alterId, input, source, false); }

  private async blockerCounts(client: PoolClient, ownerId: string, alterId: string): Promise<ErasureCounts> {
    const result = await client.query<{ todos: string; notes: string; coverage: string; images: string }>(`select
      (select count(*) from todo_assignee where owner_id = $1 and alter_id = $2::uuid) as todos,
      (select count(*) from system_note where owner_id = $1 and alter_id = $2::uuid) as notes,
      (select count(*) from coverage_assignment where owner_id = $1 and alter_id = $2::uuid) as coverage,
      (select count(*) from private_image where owner_id = $1 and alter_id = $2::uuid) as images`, [ownerId, alterId]);
    const row = result.rows[0];
    return { todos: Number(row.todos), notes: Number(row.notes), coverage: Number(row.coverage), images: Number(row.images) };
  }

  async previewEraseAlter(ownerId: string, alterId: string): Promise<ErasurePreview> {
    const client = await this.pool.connect();
    try {
      const alter = await this.alterById(client, ownerId, alterId);
      const blockers = await this.blockerCounts(client, ownerId, alterId);
      const canErase = blockers.todos + blockers.notes + blockers.coverage === 0;
      if (!canErase) return { alterId, version: alter.version, blockers, canErase };
      const expiresAt = Date.now() + 10 * 60 * 1000;
      return { alterId, version: alter.version, blockers, canErase, expiresAt: new Date(expiresAt).toISOString(), previewToken: issuePreviewToken({ ownerId, alterId, version: alter.version, blockers, expiresAt }) };
    } finally { client.release(); }
  }

  async eraseAlter(ownerId: string, alterId: string, raw: { requestId: string; expectedVersion: number; previewToken: string }, source: RecordSource) {
    const input = eraseAlterSchema.parse(raw);
    const token = readPreviewToken(input.previewToken);
    if (token.ownerId !== ownerId || token.alterId !== alterId || token.version !== input.expectedVersion || token.expiresAt < Date.now()) throw new SystemError("CONFLICT", "The erasure preview is stale. Request a fresh preview.");
    return this.mutate(ownerId, input.requestId, `erase_alter:${alterId}`, async (client) => {
      const current = await this.alterById(client, ownerId, alterId);
      if (current.version !== input.expectedVersion) throw new SystemError("CONFLICT", "The alter changed since the erasure preview.", { currentVersion: current.version });
      const blockers = await this.blockerCounts(client, ownerId, alterId);
      if (blockers.todos + blockers.notes + blockers.coverage > 0) throw new SystemError("ERASURE_BLOCKED", "Resolve todo, note, and coverage references before erasing this alter.", { blockers });
      const images = await client.query<{ storage_key: string }>("select storage_key from private_image where owner_id = $1 and alter_id = $2::uuid", [ownerId, alterId]);
      await this.removePrivateImages(images.rows.map((row) => row.storage_key));
      await client.query("update activity_event set actor_alter_id = null where owner_id = $1 and actor_alter_id = $2::uuid", [ownerId, alterId]);
      await client.query("delete from activity_event where owner_id = $1 and entity_type = 'ALTER' and entity_id = $2::uuid", [ownerId, alterId]);
      await client.query("delete from mutation_receipt where owner_id = $1 and result ->> 'id' = $2", [ownerId, alterId]);
      const removed = await client.query("delete from alter_profile where owner_id = $1 and id = $2::uuid and version = $3", [ownerId, alterId, input.expectedVersion]);
      if (!removed.rowCount) throw new SystemError("CONFLICT", "The alter changed during erasure.");
      await this.activity(client, ownerId, "ALTER", alterId, "ERASED", source, [], input.requestId);
      return { id: alterId, erased: true as const };
    });
  }

  private async todoById(client: PoolClient, ownerId: string, todoId: string, includeArchived = true) {
    const row = await client.query<TodoRow>(`${todoSelect} where t.owner_id = $1 and t.id = $2::uuid ${includeArchived ? "" : "and t.archived_at is null"}`, [ownerId, todoId]);
    if (!row.rows[0]) throw new SystemError("NOT_FOUND", "Todo not found.");
    return todoFromRow(row.rows[0]);
  }

  async getTodo(ownerId: string, todoId: string, includeArchived = false) {
    const client = await this.pool.connect();
    try { return await this.todoById(client, ownerId, todoId, includeArchived); } finally { client.release(); }
  }

  async listTodos(ownerId: string, raw: ListTodosInput = {}): Promise<Page<TodoView>> {
    const input = listTodosSchema.parse(raw);
    const values: unknown[] = [ownerId];
    const where = ["t.owner_id = $1"];
    if (!input.includeArchived) where.push("t.archived_at is null");
    if (input.status?.length) { values.push(input.status); where.push(`t.status = any($${values.length}::todo_status[])`); }
    if (input.priority?.length) { values.push(input.priority); where.push(`t.priority = any($${values.length}::todo_priority[])`); }
    if (input.assigneeAlterId) { values.push(input.assigneeAlterId); where.push(`exists (select 1 from todo_assignee filter_assignee where filter_assignee.owner_id = t.owner_id and filter_assignee.todo_id = t.id and filter_assignee.alter_id = $${values.length}::uuid)`); }
    if (input.coverageId) { values.push(input.coverageId); where.push(`t.coverage_id = $${values.length}::uuid`); }
    if (input.dueFrom) { values.push(input.dueFrom); where.push(`t.due_on >= $${values.length}::date`); }
    if (input.dueTo) { values.push(input.dueTo); where.push(`t.due_on <= $${values.length}::date`); }
    if (input.cursor) {
      const cursor = decodeCursor(input.cursor);
      values.push(cursor.createdAt, cursor.id);
      where.push(`(t.created_at, t.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(input.limit + 1);
    const rows = await this.pool.query<TodoRow>(`${todoSelect} where ${where.join(" and ")} order by t.created_at desc, t.id desc limit $${values.length}`, values);
    const all = rows.rows.map(todoFromRow);
    const data = all.slice(0, input.limit);
    return { data, nextCursor: all.length > input.limit ? encodeCursor(data[data.length - 1]) : undefined };
  }

  private async validateTodoLinks(client: PoolClient, ownerId: string, assigneeAlterIds: string[], coverageId?: string | null) {
    const uniqueAssignees = [...new Set(assigneeAlterIds)];
    if (uniqueAssignees.length) {
      const found = await client.query("select id from alter_profile where owner_id = $1 and id = any($2::uuid[])", [ownerId, uniqueAssignees]);
      if (found.rowCount !== uniqueAssignees.length) throw new SystemError("VALIDATION_ERROR", "One or more assignee alters do not belong to this owner.");
    }
    if (coverageId) {
      const found = await client.query("select 1 from coverage_assignment where owner_id = $1 and id = $2::uuid", [ownerId, coverageId]);
      if (!found.rowCount) throw new SystemError("VALIDATION_ERROR", "The coverage record does not belong to this owner.");
    }
    return uniqueAssignees;
  }

  private async replaceAssignees(client: PoolClient, ownerId: string, todoId: string, assigneeIds: string[]) {
    await client.query("delete from todo_assignee where owner_id = $1 and todo_id = $2::uuid", [ownerId, todoId]);
    for (const alterId of assigneeIds) await client.query("insert into todo_assignee (owner_id, todo_id, alter_id) values ($1, $2::uuid, $3::uuid)", [ownerId, todoId, alterId]);
  }

  async createTodo(ownerId: string, raw: TodoCreate, source: RecordSource) {
    const input = todoCreateSchema.parse(raw);
    return this.mutate(ownerId, input.requestId, "create_todo", async (client) => {
      const assignees = await this.validateTodoLinks(client, ownerId, input.assigneeAlterIds ?? [], input.coverageId);
      const inserted = await client.query<{ id: string }>(`insert into system_todo
        (owner_id, title, details, status, due_on, priority, coverage_id)
        values ($1, $2, $3, $4::todo_status, $5::date, $6::todo_priority, $7::uuid) returning id`,
      [ownerId, input.title, input.details ?? null, input.status ?? "INBOX", input.dueOn ?? null, input.priority ?? null, input.coverageId ?? null]);
      const todoId = inserted.rows[0].id;
      await this.replaceAssignees(client, ownerId, todoId, assignees);
      await this.activity(client, ownerId, "TODO", todoId, "CREATED", source, Object.keys(input).filter((key) => key !== "requestId"), input.requestId, undefined, input.status ?? "INBOX");
      return this.todoById(client, ownerId, todoId);
    });
  }

  async updateTodo(ownerId: string, todoId: string, raw: TodoPatch, source: RecordSource) {
    const input = todoPatchSchema.parse(raw);
    return this.mutate(ownerId, input.requestId, `update_todo:${todoId}`, async (client) => {
      const current = await this.todoById(client, ownerId, todoId);
      if (current.version !== input.expectedVersion) throw new SystemError("CONFLICT", "The todo changed since it was read.", { currentVersion: current.version });
      const assignees = await this.validateTodoLinks(client, ownerId, input.assigneeAlterIds ?? current.assigneeAlterIds, input.coverageId === undefined ? current.coverageId : input.coverageId);
      const changed = Object.keys(input).filter((key) => !["requestId", "expectedVersion"].includes(key));
      const updated = await client.query(`update system_todo set title = $3, details = $4, status = $5::todo_status,
        due_on = $6::date, priority = $7::todo_priority, coverage_id = $8::uuid,
        version = version + 1, updated_at = now()
        where owner_id = $1 and id = $2::uuid and version = $9`, [
        ownerId, todoId,
        input.title ?? current.title,
        input.details === undefined ? current.details ?? null : input.details,
        input.status ?? current.status,
        input.dueOn === undefined ? current.dueOn ?? null : input.dueOn,
        input.priority === undefined ? current.priority ?? null : input.priority,
        input.coverageId === undefined ? current.coverageId ?? null : input.coverageId,
        input.expectedVersion,
      ]);
      if (!updated.rowCount) {
        const latest = await this.todoById(client, ownerId, todoId);
        throw new SystemError("CONFLICT", "The todo changed since it was read.", { currentVersion: latest.version });
      }
      if (input.assigneeAlterIds) await this.replaceAssignees(client, ownerId, todoId, assignees);
      await this.activity(client, ownerId, "TODO", todoId, "UPDATED", source, changed, input.requestId, current.status, input.status ?? current.status);
      return this.todoById(client, ownerId, todoId);
    });
  }

  private async setTodoArchive(ownerId: string, todoId: string, raw: { requestId: string; expectedVersion: number }, source: RecordSource, archived: boolean) {
    const input = versionMutationSchema.parse(raw);
    const verb = archived ? "archive" : "restore";
    return this.mutate(ownerId, input.requestId, `${verb}_todo:${todoId}`, async (client) => {
      const result = await client.query(`update system_todo set archived_at = ${archived ? "now()" : "null"}, version = version + 1, updated_at = now()
        where owner_id = $1 and id = $2::uuid and version = $3`, [ownerId, todoId, input.expectedVersion]);
      if (!result.rowCount) await this.throwVersionOrNotFound(client, "system_todo", ownerId, todoId);
      await this.activity(client, ownerId, "TODO", todoId, archived ? "ARCHIVED" : "RESTORED", source, ["archivedAt"], input.requestId);
      return this.todoById(client, ownerId, todoId);
    });
  }

  archiveTodo(ownerId: string, todoId: string, input: { requestId: string; expectedVersion: number }, source: RecordSource) { return this.setTodoArchive(ownerId, todoId, input, source, true); }
  restoreTodo(ownerId: string, todoId: string, input: { requestId: string; expectedVersion: number }, source: RecordSource) { return this.setTodoArchive(ownerId, todoId, input, source, false); }

  async eraseTodo(ownerId: string, todoId: string, raw: { requestId: string; expectedVersion: number }, source: RecordSource) {
    const input = versionMutationSchema.parse(raw);
    return this.mutate(ownerId, input.requestId, `erase_todo:${todoId}`, async (client) => {
      const current = await this.todoById(client, ownerId, todoId);
      if (current.version !== input.expectedVersion) throw new SystemError("CONFLICT", "The todo changed since it was read.", { currentVersion: current.version });
      await client.query("delete from activity_event where owner_id = $1 and entity_type = 'TODO' and entity_id = $2::uuid", [ownerId, todoId]);
      await client.query("delete from mutation_receipt where owner_id = $1 and result ->> 'id' = $2", [ownerId, todoId]);
      const removed = await client.query("delete from system_todo where owner_id = $1 and id = $2::uuid and version = $3", [ownerId, todoId, input.expectedVersion]);
      if (!removed.rowCount) throw new SystemError("CONFLICT", "The todo changed during erasure.");
      await this.activity(client, ownerId, "TODO", todoId, "ERASED", source, [], input.requestId, current.status);
      return { id: todoId, erased: true as const };
    });
  }

  async setNoteAlter(ownerId: string, noteId: string, alterId: string | null, expectedVersion: number, requestId: string, source: RecordSource) {
    return this.mutate(ownerId, requestId, `set_note_alter:${noteId}`, async (client) => {
      if (alterId) await this.validateTodoLinks(client, ownerId, [alterId], null);
      const result = await client.query(`update system_note set alter_id = $3::uuid, version = version + 1, updated_at = now()
        where owner_id = $1 and id = $2::uuid and version = $4 returning id, alter_id, version, updated_at`, [ownerId, noteId, alterId, expectedVersion]);
      if (!result.rows[0]) await this.throwVersionOrNotFound(client, "system_note", ownerId, noteId);
      await this.activity(client, ownerId, "NOTE", noteId, "ALTER_REASSIGNED", source, ["alterId"], requestId);
      const row = result.rows[0];
      return { id: String(row.id), alterId: row.alter_id ? String(row.alter_id) : undefined, version: Number(row.version), updatedAt: asIso(row.updated_at) };
    });
  }

  async reassignCoverage(ownerId: string, coverageId: string, alterId: string, expectedVersion: number, requestId: string, source: RecordSource) {
    return this.mutate(ownerId, requestId, `reassign_coverage:${coverageId}`, async (client) => {
      await this.validateTodoLinks(client, ownerId, [alterId], null);
      const result = await client.query(`update coverage_assignment set alter_id = $3::uuid, version = version + 1
        where owner_id = $1 and id = $2::uuid and version = $4 returning id, alter_id, version`, [ownerId, coverageId, alterId, expectedVersion]);
      if (!result.rows[0]) await this.throwVersionOrNotFound(client, "coverage_assignment", ownerId, coverageId);
      await this.activity(client, ownerId, "COVERAGE", coverageId, "ALTER_REASSIGNED", source, ["alterId"], requestId);
      return { id: String(result.rows[0].id), alterId: String(result.rows[0].alter_id), version: Number(result.rows[0].version) };
    });
  }

  async eraseCoverageRecord(ownerId: string, coverageId: string, expectedVersion: number, requestId: string, source: RecordSource) {
    return this.mutate(ownerId, requestId, `erase_coverage:${coverageId}`, async (client) => {
      const links = await client.query<{ notes: string; todos: string }>(`select
        (select count(*) from system_note where owner_id = $1 and coverage_id = $2::uuid) as notes,
        (select count(*) from system_todo where owner_id = $1 and coverage_id = $2::uuid) as todos`, [ownerId, coverageId]);
      if (Number(links.rows[0].notes) + Number(links.rows[0].todos) > 0) throw new SystemError("ERASURE_BLOCKED", "Resolve note and todo coverage links before erasing this coverage record.", { notes: Number(links.rows[0].notes), todos: Number(links.rows[0].todos) });
      const removed = await client.query("delete from coverage_assignment where owner_id = $1 and id = $2::uuid and version = $3", [ownerId, coverageId, expectedVersion]);
      if (!removed.rowCount) await this.throwVersionOrNotFound(client, "coverage_assignment", ownerId, coverageId);
      await this.activity(client, ownerId, "COVERAGE", coverageId, "ERASED", source, [], requestId);
      return { id: coverageId, erased: true as const };
    });
  }

  private async throwVersionOrNotFound(client: PoolClient, table: "alter_profile" | "system_todo" | "system_note" | "coverage_assignment", ownerId: string, id: string): Promise<never> {
    const current = await client.query(`select version from ${table} where owner_id = $1 and id = $2::uuid`, [ownerId, id]);
    if (!current.rows[0]) throw new SystemError("NOT_FOUND", "Record not found.");
    throw new SystemError("CONFLICT", "The record changed since it was read.", { currentVersion: Number(current.rows[0].version) });
  }
}

let singleton: SystemService | undefined;
export function getSystemService() {
  singleton ??= new SystemService();
  return singleton;
}
