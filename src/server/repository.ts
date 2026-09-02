import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { toConfirmedCoverage } from "@/domain/coverage";
import type { AlterProfile, CoverageAssignment, ConfirmedCoverage, PrivateImage, SystemNote, SystemPreference, SystemTodo } from "@/domain/types";

export function postgresDateOnly(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("Invalid Postgres date value.");
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  if (!match) throw new Error("Invalid Postgres date value.");
  return match[0];
}

export type ProfileInput = Pick<AlterProfile, "name" | "selfDescribedGender" | "description">;

export interface SystemRepository {
  listProfiles(ownerId: string): Promise<AlterProfile[]>;
  saveProfile(ownerId: string, input: ProfileInput, profileId?: string): Promise<AlterProfile>;
  attachImage(ownerId: string, alterId: string, image: PrivateImage): Promise<void>;
  getImage(ownerId: string, imageId: string): Promise<PrivateImage | null>;
  listAssignments(ownerId: string): Promise<CoverageAssignment[]>;
  createDraft(ownerId: string, input: Omit<CoverageAssignment, "id" | "ownerId" | "createdAt" | "confirmedAt" | "status">): Promise<CoverageAssignment>;
  resolveDraft(ownerId: string, draftId: string, result: "CONFIRMED" | "REJECTED", alterId?: string): Promise<CoverageAssignment>;
  confirmedDuring(ownerId: string, startsOn: string, endsOn: string): Promise<ConfirmedCoverage[]>;
  ownsImage(ownerId: string, storageKey: string): Promise<boolean>;
  listNotes(ownerId: string): Promise<SystemNote[]>;
  saveNote(ownerId: string, input: Omit<SystemNote, "id" | "ownerId" | "createdAt">): Promise<SystemNote>;
  listTodos(ownerId: string): Promise<SystemTodo[]>;
  saveTodo(ownerId: string, input: Omit<SystemTodo, "id" | "ownerId" | "createdAt">): Promise<SystemTodo>;
  listPreferences(ownerId: string): Promise<SystemPreference[]>;
  savePreference(ownerId: string, key: string, value: string): Promise<SystemPreference>;
}

class MemorySystemRepository implements SystemRepository {
  private readonly profiles: AlterProfile[] = [];
  private readonly assignments: CoverageAssignment[] = [];
  private readonly notes: SystemNote[] = [];
  private readonly todos: SystemTodo[] = [];
  private readonly preferences = new Map<string, SystemPreference>();

  async listProfiles(ownerId: string) {
    return this.profiles.filter((profile) => profile.ownerId === ownerId).map((profile) => structuredClone(profile));
  }

  async saveProfile(ownerId: string, input: ProfileInput, profileId?: string) {
    const now = new Date().toISOString();
    const existing = profileId && this.profiles.find((profile) => profile.id === profileId && profile.ownerId === ownerId);
    if (existing) {
      Object.assign(existing, input, { updatedAt: now });
      return structuredClone(existing);
    }
    const profile: AlterProfile = { id: randomUUID(), ownerId, ...input, images: [], createdAt: now, updatedAt: now };
    this.profiles.push(profile);
    return structuredClone(profile);
  }

  async attachImage(ownerId: string, alterId: string, image: PrivateImage) {
    const profile = this.profiles.find((item) => item.id === alterId && item.ownerId === ownerId);
    if (!profile) throw new Error("Profile not found.");
    profile.images.push(image);
    profile.updatedAt = new Date().toISOString();
  }

  async getImage(ownerId: string, imageId: string) {
    const profile = this.profiles.find((item) => item.ownerId === ownerId && item.images.some((image) => image.id === imageId));
    return structuredClone(profile?.images.find((image) => image.id === imageId) ?? null);
  }

  async listAssignments(ownerId: string) {
    return this.assignments.filter((item) => item.ownerId === ownerId).map((item) => structuredClone(item));
  }

  async createDraft(ownerId: string, input: Omit<CoverageAssignment, "id" | "ownerId" | "createdAt" | "confirmedAt" | "status">) {
    const draft: CoverageAssignment = { id: randomUUID(), ownerId, ...input, status: "DRAFT", createdAt: new Date().toISOString() };
    this.assignments.push(draft);
    return structuredClone(draft);
  }

  async resolveDraft(ownerId: string, draftId: string, result: "CONFIRMED" | "REJECTED", alterId?: string) {
    const draft = this.assignments.find((item) => item.id === draftId && item.ownerId === ownerId && item.status === "DRAFT");
    if (!draft) throw new Error("Draft not found or has already been resolved.");
    if (result === "CONFIRMED" && !alterId && !draft.alterId) throw new Error("Choose an alter before confirming.");
    if (alterId) draft.alterId = alterId;
    draft.status = result;
    if (result === "CONFIRMED") draft.confirmedAt = new Date().toISOString();
    return structuredClone(draft);
  }

  async confirmedDuring(ownerId: string, startsOn: string, endsOn: string) {
    const profiles = await this.listProfiles(ownerId);
    return this.assignments
      .filter((item) => item.ownerId === ownerId && item.status === "CONFIRMED")
      .filter((item) => item.startsOn <= endsOn && startsOn <= (item.endsOn ?? "9999-12-31"))
      .flatMap((item) => {
        const coverage = toConfirmedCoverage(item, profiles);
        return coverage ? [coverage] : [];
      });
  }

  async ownsImage(ownerId: string, storageKey: string) {
    return this.profiles.some((profile) => profile.ownerId === ownerId && profile.images.some((image) => image.storageKey === storageKey));
  }

  async listNotes(ownerId: string) { return this.notes.filter((note) => note.ownerId === ownerId).map((note) => structuredClone(note)); }

  async saveNote(ownerId: string, input: Omit<SystemNote, "id" | "ownerId" | "createdAt">) {
    const note: SystemNote = { id: randomUUID(), ownerId, ...input, createdAt: new Date().toISOString() };
    this.notes.push(note);
    return structuredClone(note);
  }

  async listTodos(ownerId: string) { return this.todos.filter((todo) => todo.ownerId === ownerId).map((todo) => structuredClone(todo)); }

  async saveTodo(ownerId: string, input: Omit<SystemTodo, "id" | "ownerId" | "createdAt">) {
    const todo: SystemTodo = { id: randomUUID(), ownerId, ...input, createdAt: new Date().toISOString() };
    this.todos.push(todo);
    return structuredClone(todo);
  }

  async listPreferences(ownerId: string) {
    return [...this.preferences.values()].filter((preference) => preference.key.startsWith(`${ownerId}:`)).map((preference) => ({ ...preference, key: preference.key.slice(ownerId.length + 1) }));
  }

  async savePreference(ownerId: string, key: string, value: string) {
    const preference: SystemPreference = { key: `${ownerId}:${key}`, value, updatedAt: new Date().toISOString() };
    this.preferences.set(preference.key, preference);
    return { ...preference, key };
  }
}

class NeonSystemRepository implements SystemRepository {
  private sql() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("Postgres is not configured.");
    return neon(databaseUrl);
  }

  private async ensureOwner(ownerId: string) {
    const sql = this.sql();
    await sql`insert into app_user (id, google_subject) values (${ownerId}, ${ownerId}) on conflict (id) do nothing`;
  }

  async listProfiles(ownerId: string) {
    const sql = this.sql();
    const rows = await sql`select a.id, a.owner_id, a.name, a.self_described_gender, a.description, a.created_at, a.updated_at,
      coalesce(json_agg(json_build_object('id', i.id, 'storageKey', i.storage_key, 'contentType', i.content_type)) filter (where i.id is not null), '[]'::json) as images
      from alter_profile a left join private_image i on i.alter_id = a.id
      where a.owner_id = ${ownerId} and a.archived_at is null group by a.id order by a.created_at asc`;
    return rows.map((row) => ({ id: String(row.id), ownerId: String(row.owner_id), name: String(row.name), selfDescribedGender: row.self_described_gender ? String(row.self_described_gender) : undefined, description: row.description ? String(row.description) : undefined, images: row.images as PrivateImage[], createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString() }));
  }

  async saveProfile(ownerId: string, input: ProfileInput, profileId?: string) {
    await this.ensureOwner(ownerId);
    const sql = this.sql();
    if (profileId) {
      const updated = await sql`update alter_profile set name = ${input.name}, self_described_gender = ${input.selfDescribedGender ?? null}, description = ${input.description ?? null}, version = version + 1, updated_at = now() where id = ${profileId}::uuid and owner_id = ${ownerId} returning id`;
      if (!updated.length) throw new Error("Profile not found.");
      const profile = (await this.listProfiles(ownerId)).find((candidate) => candidate.id === profileId);
      if (!profile) throw new Error("Profile not found.");
      return profile;
    }
    const created = await sql`insert into alter_profile (id, owner_id, name, self_described_gender, description) values (gen_random_uuid(), ${ownerId}, ${input.name}, ${input.selfDescribedGender ?? null}, ${input.description ?? null}) returning id`;
    const profile = (await this.listProfiles(ownerId)).find((candidate) => candidate.id === String(created[0].id));
    if (!profile) throw new Error("Unable to create profile.");
    return profile;
  }

  async attachImage(ownerId: string, alterId: string, image: PrivateImage) {
    await this.ensureOwner(ownerId);
    const sql = this.sql();
    const rows = await sql`insert into private_image (id, owner_id, alter_id, storage_key, content_type)
      select ${image.id}::uuid, ${ownerId}, a.id, ${image.storageKey}, ${image.contentType} from alter_profile a where a.id = ${alterId}::uuid and a.owner_id = ${ownerId} returning id`;
    if (!rows.length) throw new Error("Profile not found.");
  }

  async getImage(ownerId: string, imageId: string) {
    const sql = this.sql();
    const rows = await sql`select id, storage_key, content_type from private_image where owner_id = ${ownerId} and id = ${imageId}::uuid limit 1`;
    const row = rows[0];
    return row ? { id: String(row.id), storageKey: String(row.storage_key), contentType: String(row.content_type) } : null;
  }

  async listAssignments(ownerId: string) {
    const sql = this.sql();
    const rows = await sql`select id, owner_id, alter_id, starts_on, ends_on, status, suggestion_reasons, created_at, confirmed_at from coverage_assignment where owner_id = ${ownerId} order by starts_on desc, created_at desc`;
    return rows.map((row) => ({ id: String(row.id), ownerId: String(row.owner_id), alterId: row.alter_id ? String(row.alter_id) : undefined, startsOn: postgresDateOnly(row.starts_on), endsOn: row.ends_on ? postgresDateOnly(row.ends_on) : undefined, status: String(row.status).toUpperCase() as CoverageAssignment["status"], reasons: row.suggestion_reasons as string[], createdAt: new Date(String(row.created_at)).toISOString(), confirmedAt: row.confirmed_at ? new Date(String(row.confirmed_at)).toISOString() : undefined }));
  }

  async createDraft(ownerId: string, input: Omit<CoverageAssignment, "id" | "ownerId" | "createdAt" | "confirmedAt" | "status">) {
    await this.ensureOwner(ownerId);
    const sql = this.sql();
    const rows = await sql`insert into coverage_assignment (id, owner_id, alter_id, starts_on, ends_on, status, suggestion_reasons) values (gen_random_uuid(), ${ownerId}, ${input.alterId ?? null}::uuid, ${input.startsOn}::date, ${input.endsOn ?? null}::date, 'draft', ${JSON.stringify(input.reasons)}::jsonb) returning id`;
    const assignment = (await this.listAssignments(ownerId)).find((candidate) => candidate.id === String(rows[0].id));
    if (!assignment) throw new Error("Unable to create draft.");
    return assignment;
  }

  async resolveDraft(ownerId: string, draftId: string, result: "CONFIRMED" | "REJECTED", alterId?: string) {
    const sql = this.sql();
    const rows = await sql`update coverage_assignment set alter_id = coalesce(${alterId ?? null}::uuid, alter_id), status = ${result.toLowerCase()}::coverage_status, confirmed_at = case when ${result} = 'CONFIRMED' then now() else null end where id = ${draftId}::uuid and owner_id = ${ownerId} and status = 'draft' returning id`;
    if (!rows.length) throw new Error("Draft not found or has already been resolved.");
    const assignment = (await this.listAssignments(ownerId)).find((candidate) => candidate.id === draftId);
    if (!assignment) throw new Error("Draft not found.");
    return assignment;
  }

  async confirmedDuring(ownerId: string, startsOn: string, endsOn: string) {
    const sql = this.sql();
    const rows = await sql`select c.id, c.alter_id, a.name, c.starts_on, c.ends_on from coverage_assignment c join alter_profile a on a.id = c.alter_id where c.owner_id = ${ownerId} and c.status = 'confirmed' and c.starts_on <= ${endsOn}::date and ${startsOn}::date <= coalesce(c.ends_on, 'infinity'::date) order by c.starts_on asc`;
    return rows.map((row) => ({ id: String(row.id), alterId: String(row.alter_id), alterName: String(row.name), startsOn: postgresDateOnly(row.starts_on), endsOn: row.ends_on ? postgresDateOnly(row.ends_on) : undefined }));
  }

  async ownsImage(ownerId: string, storageKey: string) {
    const sql = this.sql();
    const rows = await sql`select 1 from private_image where owner_id = ${ownerId} and storage_key = ${storageKey} limit 1`;
    return rows.length > 0;
  }

  async listNotes(ownerId: string) {
    const sql = this.sql();
    const rows = await sql`select n.id, n.owner_id, n.body, n.alter_id, n.coverage_id, n.created_at,
      (select ae.actor_alter_id from activity_event ae
       where ae.owner_id = n.owner_id and ae.entity_type = 'NOTE' and ae.entity_id = n.id and ae.action = 'CREATED'
       order by ae.created_at asc limit 1) as actor_alter_id
      from system_note n where n.owner_id = ${ownerId} order by n.created_at desc`;
    return rows.map((row) => ({ id: String(row.id), ownerId: String(row.owner_id), body: String(row.body), alterId: row.alter_id ? String(row.alter_id) : undefined, coverageId: row.coverage_id ? String(row.coverage_id) : undefined, actorAlterId: row.actor_alter_id ? String(row.actor_alter_id) : undefined, createdAt: new Date(String(row.created_at)).toISOString() }));
  }

  async saveNote(ownerId: string, input: Omit<SystemNote, "id" | "ownerId" | "createdAt">) {
    await this.ensureOwner(ownerId);
    const sql = this.sql();
    const changedFields = ["body", ...(input.alterId ? ["alterId"] : []), ...(input.coverageId ? ["coverageId"] : []), ...(input.actorAlterId ? ["actorAlterId"] : [])];
    const rows = await sql`with note as (
      insert into system_note (id, owner_id, body, alter_id, coverage_id)
      values (gen_random_uuid(), ${ownerId}, ${input.body}, ${input.alterId ?? null}::uuid, ${input.coverageId ?? null}::uuid)
      returning id, owner_id, body, alter_id, coverage_id, created_at
    ), event as (
      insert into activity_event (owner_id, entity_type, entity_id, action, source, changed_fields, actor_alter_id)
      select note.owner_id, 'NOTE', note.id, 'CREATED', 'MCP'::record_source, ${changedFields}::text[], ${input.actorAlterId ?? null}::uuid
      from note
    )
    select note.*, ${input.actorAlterId ?? null}::uuid as actor_alter_id from note`;
    const row = rows[0];
    return { id: String(row.id), ownerId, body: String(row.body), alterId: row.alter_id ? String(row.alter_id) : undefined, coverageId: row.coverage_id ? String(row.coverage_id) : undefined, actorAlterId: row.actor_alter_id ? String(row.actor_alter_id) : undefined, createdAt: new Date(String(row.created_at)).toISOString() };
  }

  async listTodos(ownerId: string) {
    const sql = this.sql();
    const rows = await sql`select t.id, t.owner_id, t.title, t.coverage_id, t.status, t.created_at,
      (select ta.alter_id from todo_assignee ta where ta.owner_id = t.owner_id and ta.todo_id = t.id order by ta.created_at asc limit 1) as alter_id
      from system_todo t where t.owner_id = ${ownerId} and t.archived_at is null order by t.created_at desc`;
    return rows.map((row) => ({ id: String(row.id), ownerId: String(row.owner_id), title: String(row.title), alterId: row.alter_id ? String(row.alter_id) : undefined, coverageId: row.coverage_id ? String(row.coverage_id) : undefined, status: ["DONE", "CANCELLED"].includes(String(row.status)) ? "DONE" as const : "OPEN" as const, createdAt: new Date(String(row.created_at)).toISOString() }));
  }

  async saveTodo(ownerId: string, input: Omit<SystemTodo, "id" | "ownerId" | "createdAt">) {
    await this.ensureOwner(ownerId);
    const sql = this.sql();
    const rows = await sql`insert into system_todo (id, owner_id, title, coverage_id, status) values (gen_random_uuid(), ${ownerId}, ${input.title}, ${input.coverageId ?? null}::uuid, ${input.status}::todo_status) returning id, created_at`;
    if (input.alterId) await sql`insert into todo_assignee (owner_id, todo_id, alter_id) values (${ownerId}, ${rows[0].id}::uuid, ${input.alterId}::uuid)`;
    return { id: String(rows[0].id), ownerId, ...input, createdAt: new Date(String(rows[0].created_at)).toISOString() };
  }

  async listPreferences(ownerId: string) {
    const sql = this.sql();
    const rows = await sql`select preference_key, preference_value, updated_at from system_preference where owner_id = ${ownerId} order by preference_key asc`;
    return rows.map((row) => ({ key: String(row.preference_key), value: typeof row.preference_value === "string" ? row.preference_value : JSON.stringify(row.preference_value), updatedAt: new Date(String(row.updated_at)).toISOString() }));
  }

  async savePreference(ownerId: string, key: string, value: string) {
    await this.ensureOwner(ownerId);
    const sql = this.sql();
    const rows = await sql`insert into system_preference (owner_id, preference_key, preference_value) values (${ownerId}, ${key}, ${JSON.stringify(value)}::jsonb) on conflict (owner_id, preference_key) do update set preference_value = excluded.preference_value, updated_at = now() returning updated_at`;
    return { key, value, updatedAt: new Date(String(rows[0].updated_at)).toISOString() };
  }
}

class UnconfiguredRepository implements SystemRepository {
  private unavailable(): never { throw new Error("System storage is not configured."); }
  listProfiles(): Promise<AlterProfile[]> { return Promise.reject(this.unavailable()); }
  saveProfile(): Promise<AlterProfile> { return Promise.reject(this.unavailable()); }
  attachImage(): Promise<void> { return Promise.reject(this.unavailable()); }
  getImage(): Promise<PrivateImage | null> { return Promise.reject(this.unavailable()); }
  listAssignments(): Promise<CoverageAssignment[]> { return Promise.reject(this.unavailable()); }
  createDraft(): Promise<CoverageAssignment> { return Promise.reject(this.unavailable()); }
  resolveDraft(): Promise<CoverageAssignment> { return Promise.reject(this.unavailable()); }
  confirmedDuring(): Promise<ConfirmedCoverage[]> { return Promise.reject(this.unavailable()); }
  ownsImage(): Promise<boolean> { return Promise.reject(this.unavailable()); }
  listNotes(): Promise<SystemNote[]> { return Promise.reject(this.unavailable()); }
  saveNote(): Promise<SystemNote> { return Promise.reject(this.unavailable()); }
  listTodos(): Promise<SystemTodo[]> { return Promise.reject(this.unavailable()); }
  saveTodo(): Promise<SystemTodo> { return Promise.reject(this.unavailable()); }
  listPreferences(): Promise<SystemPreference[]> { return Promise.reject(this.unavailable()); }
  savePreference(): Promise<SystemPreference> { return Promise.reject(this.unavailable()); }
}

export const repository: SystemRepository = process.env.SYSTEM_DEMO_MODE === "true"
  ? new MemorySystemRepository()
  : process.env.DATABASE_URL ? new NeonSystemRepository() : new UnconfiguredRepository();
