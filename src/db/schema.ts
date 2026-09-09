import {
  boolean,
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const coverageStatus = pgEnum("coverage_status", ["draft", "confirmed", "rejected"]);
export const todoStatus = pgEnum("todo_status", ["INBOX", "OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED"]);
export const todoPriority = pgEnum("todo_priority", ["LOW", "NORMAL", "HIGH"]);
export const recordSource = pgEnum("record_source", ["MCP", "WEB", "SYSTEM"]);
export const catchUpItemType = pgEnum("catch_up_item_type", ["NOTE", "TODO", "DECISION", "THREAD"]);
export const catchUpReviewState = pgEnum("catch_up_review_state", ["NEW", "ACKNOWLEDGED", "DEFERRED", "RESOLVED"]);
export const importantThreadSource = pgEnum("important_thread_source", ["CODEX", "CHATGPT"]);
export const importantThreadStatus = pgEnum("important_thread_status", ["SUGGESTED", "CONFIRMED", "ARCHIVED"]);
export const groupPhotoProjectStatus = pgEnum("group_photo_project_status", ["ANALYZING", "READY", "BLOCKING", "RENDERING", "COMPLETE", "FAILED"]);

export const appUser = pgTable("app_user", {
  id: text("id").primaryKey(),
  googleSubject: text("google_subject").notNull().unique(),
  timeZone: text("time_zone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const galleryShare = pgTable("gallery_share", {
  showCurrentFronting: boolean("show_current_fronting").notNull().default(false),
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("gallery_share_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const alterProfile = pgTable("alter_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  pronouns: text("pronouns"),
  species: text("species"),
  visualDescription: text("visual_description"),
  presentation: text("presentation"),
  signatureTraits: text("signature_traits").array().notNull().default([]),
  styleTags: text("style_tags").array().notNull().default([]),
  imageDoNotChange: text("image_do_not_change").array().notNull().default([]),
  selfDescribedGender: text("self_described_gender"),
  description: text("description"),
  communicationGuidance: text("communication_guidance"),
  strengths: text("strengths").array().notNull().default([]),
  boundaries: text("boundaries").array().notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [unique("alter_profile_owner_id_id_key").on(table.ownerId, table.id)]);

export const alterAlias = pgTable("alter_alias", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  alias: text("alias").notNull(),
  normalizedAlias: text("normalized_alias").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("alter_alias_owner_normalized_key").on(table.ownerId, table.normalizedAlias),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "alter_alias_owner_alter_fk" }).onDelete("cascade"),
]);

export const privateImage = pgTable("private_image", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  isProfilePicture: boolean("is_profile_picture").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "private_image_owner_alter_fk" }).onDelete("cascade"),
  unique("private_image_owner_id_id_key").on(table.ownerId, table.id),
  uniqueIndex("private_image_one_profile_picture").on(table.ownerId, table.alterId).where(sql`${table.isProfilePicture} = true`),
]);

export const groupPhotoProject = pgTable("group_photo_project", {
  id: uuid("id").primaryKey().defaultRandom(), ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  backplateStorageKey: text("backplate_storage_key").notNull().unique(), backplateContentType: text("backplate_content_type").notNull(),
  sceneAnalysis: jsonb("scene_analysis").notNull(), status: groupPhotoProjectStatus("status").notNull().default("READY"), version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("group_photo_project_owner_updated_idx").on(table.ownerId, table.updatedAt)]);

export const groupPhotoPlacement = pgTable("group_photo_placement", {
  id: uuid("id").primaryKey().defaultRandom(), projectId: uuid("project_id").notNull().references(() => groupPhotoProject.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(), alterId: uuid("alter_id").notNull(), tokenX: integer("token_x").notNull(), tokenY: integer("token_y").notNull(),
  depth: integer("depth").notNull().default(50), occupancyZoneId: text("occupancy_zone_id"), relationHints: jsonb("relation_hints").notNull().default([]), version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("group_photo_placement_project_alter_key").on(table.projectId, table.alterId), foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "group_photo_placement_owner_alter_fk" }).onDelete("cascade"), index("group_photo_placement_project_idx").on(table.projectId)]);

export const coverageAssignment = pgTable("coverage_assignment", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  alterId: uuid("alter_id"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on"),
  status: coverageStatus("status").notNull().default("draft"),
  suggestionReasons: jsonb("suggestion_reasons").notNull().default([]),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => [
  unique("coverage_assignment_owner_id_id_key").on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "coverage_assignment_owner_alter_fk" }).onDelete("restrict"),
  index("coverage_confirmed_owner_dates").on(table.ownerId, table.startsOn, table.endsOn),
]);

export const frontingSession = pgTable("fronting_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  alterId: uuid("alter_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("fronting_session_owner_id_id_key").on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "fronting_session_owner_alter_fk" }).onDelete("cascade"),
  index("fronting_session_owner_started_idx").on(table.ownerId, table.startedAt),
  uniqueIndex("fronting_session_one_current_per_owner").on(table.ownerId).where(sql`${table.endedAt} is null`),
  check("fronting_session_valid_range", sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`),
]);

export const systemNote = pgTable("system_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  alterId: uuid("alter_id"),
  coverageId: uuid("coverage_id"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("system_note_owner_id_id_key").on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "system_note_owner_alter_fk" }).onDelete("restrict"),
  foreignKey({ columns: [table.ownerId, table.coverageId], foreignColumns: [coverageAssignment.ownerId, coverageAssignment.id], name: "system_note_owner_coverage_fk" }).onDelete("restrict"),
]);

export const systemTodo = pgTable("system_todo", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  details: text("details"),
  dueOn: date("due_on"),
  priority: todoPriority("priority"),
  status: todoStatus("status").notNull().default("INBOX"),
  coverageId: uuid("coverage_id"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  unique("system_todo_owner_id_id_key").on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.coverageId], foreignColumns: [coverageAssignment.ownerId, coverageAssignment.id], name: "system_todo_owner_coverage_fk" }).onDelete("restrict"),
]);

export const todoAssignee = pgTable("todo_assignee", {
  ownerId: text("owner_id").notNull(),
  todoId: uuid("todo_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.todoId, table.alterId] }),
  foreignKey({ columns: [table.ownerId, table.todoId], foreignColumns: [systemTodo.ownerId, systemTodo.id], name: "todo_assignee_owner_todo_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "todo_assignee_owner_alter_fk" }).onDelete("restrict"),
]);

export const activityEvent = pgTable("activity_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  action: text("action").notNull(),
  source: recordSource("source").notNull(),
  changedFields: text("changed_fields").array().notNull().default([]),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  actorAlterId: uuid("actor_alter_id"),
  requestId: uuid("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.ownerId, table.actorAlterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "activity_event_owner_actor_fk" }).onDelete("restrict"),
  index("activity_event_owner_entity_idx").on(table.ownerId, table.entityType, table.entityId, table.createdAt),
]);

export const mutationReceipt = pgTable("mutation_receipt", {
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  requestId: uuid("request_id").notNull(),
  operation: text("operation").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.requestId] })]);

export const systemPreference = pgTable("system_preference", {
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  preferenceKey: text("preference_key").notNull(),
  preferenceValue: jsonb("preference_value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.preferenceKey] })]);

export const importantThread = pgTable("important_thread", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  source: importantThreadSource("source").notNull(),
  externalThreadId: text("external_thread_id").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  approvedSummary: text("approved_summary").notNull(),
  keyDecisionOrAction: text("key_decision_or_action").notNull(),
  flaggedByAlterId: uuid("flagged_by_alter_id"),
  status: importantThreadStatus("status").notNull().default("SUGGESTED"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (table) => [
  unique("important_thread_owner_id_id_key").on(table.ownerId, table.id),
  unique("important_thread_owner_external_key").on(table.ownerId, table.source, table.externalThreadId),
  foreignKey({ columns: [table.ownerId, table.flaggedByAlterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "important_thread_owner_flagger_fk" }).onDelete("restrict"),
]);

export const importantThreadRecipient = pgTable("important_thread_recipient", {
  ownerId: text("owner_id").notNull(),
  threadId: uuid("thread_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.threadId, table.alterId] }),
  foreignKey({ columns: [table.ownerId, table.threadId], foreignColumns: [importantThread.ownerId, importantThread.id], name: "important_thread_recipient_thread_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "important_thread_recipient_alter_fk" }).onDelete("restrict"),
]);

export const systemDecision = pgTable("system_decision", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  decision: text("decision").notNull(),
  rationale: text("rationale"),
  nextAction: text("next_action").notNull(),
  actorAlterId: uuid("actor_alter_id"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  unique("system_decision_owner_id_id_key").on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.actorAlterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "system_decision_owner_actor_fk" }).onDelete("restrict"),
]);

export const systemDecisionRecipient = pgTable("system_decision_recipient", {
  ownerId: text("owner_id").notNull(),
  decisionId: uuid("decision_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.decisionId, table.alterId] }),
  foreignKey({ columns: [table.ownerId, table.decisionId], foreignColumns: [systemDecision.ownerId, systemDecision.id], name: "system_decision_recipient_decision_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "system_decision_recipient_alter_fk" }).onDelete("restrict"),
]);

export const presenceKind = pgEnum("presence_kind", ["HOSTING", "FRONTING"]);
// Hosting periods are maintained atomically by the system_host_record_period trigger.
// Fronting episodes overlap hosting and each other, and close only explicitly.
export const presencePeriod = pgTable("presence_period", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  alterId: uuid("alter_id").notNull(),
  kind: presenceKind("kind").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().default(sql`date_trunc('milliseconds', clock_timestamp())`),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  origin: text("origin").notNull().default("EXPLICIT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  unique("presence_period_owner_id_id_key").on(table.ownerId, table.id),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "presence_period_owner_alter_fk" }).onDelete("cascade"),
  uniqueIndex("presence_period_one_host").on(table.ownerId).where(sql`${table.kind} = 'HOSTING' and ${table.endedAt} is null`),
  uniqueIndex("presence_period_one_episode_per_alter").on(table.ownerId, table.alterId).where(sql`${table.kind} = 'FRONTING' and ${table.endedAt} is null`),
  index("presence_period_owner_started").on(table.ownerId, table.startedAt, table.id),
  check("presence_period_positive_version", sql`${table.version} > 0`),
  check("presence_period_valid_range", sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`),
  check("presence_period_origin", sql`${table.origin} in ('EXPLICIT', 'SYSTEM_HOST_SNAPSHOT')`),
]);

export const catchUpSession = pgTable("catch_up_session", {
  narrativeRevision: integer("narrative_revision").notNull().default(0),
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  frontingSessionId: uuid("fronting_session_id"),
  presencePeriodId: uuid("presence_period_id"),
  alterId: uuid("alter_id").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  firstTime: boolean("first_time").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("catch_up_session_owner_id_id_key").on(table.ownerId, table.id),
  unique("catch_up_session_owner_presence_key").on(table.ownerId, table.presencePeriodId),
  foreignKey({ columns: [table.ownerId, table.presencePeriodId], foreignColumns: [presencePeriod.ownerId, presencePeriod.id], name: "catch_up_session_owner_presence_fk" }).onDelete("cascade"),
  check("catch_up_session_one_source", sql`(${table.frontingSessionId} is not null)::int + (${table.presencePeriodId} is not null)::int = 1`),
  unique("catch_up_session_owner_front_key").on(table.ownerId, table.frontingSessionId),
  foreignKey({ columns: [table.ownerId, table.frontingSessionId], foreignColumns: [frontingSession.ownerId, frontingSession.id], name: "catch_up_session_owner_front_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "catch_up_session_owner_alter_fk" }).onDelete("cascade"),
  check("catch_up_session_valid_window", sql`${table.windowStart} is null or ${table.windowEnd} >= ${table.windowStart}`),
]);

export const catchUpEntry = pgTable("catch_up_entry", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  sessionId: uuid("session_id").notNull(),
  itemType: catchUpItemType("item_type").notNull(),
  itemId: uuid("item_id").notNull(),
  reviewState: catchUpReviewState("review_state").notNull().default("NEW"),
  deferUntil: timestamp("defer_until", { withTimezone: true }),
  deferUntilNextSwitch: boolean("defer_until_next_switch").notNull().default(false),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("catch_up_entry_owner_id_id_key").on(table.ownerId, table.id),
  unique("catch_up_entry_session_item_key").on(table.ownerId, table.sessionId, table.itemType, table.itemId),
  foreignKey({ columns: [table.ownerId, table.sessionId], foreignColumns: [catchUpSession.ownerId, catchUpSession.id], name: "catch_up_entry_owner_session_fk" }).onDelete("cascade"),
  check("catch_up_entry_defer_state", sql`(${table.reviewState} = 'DEFERRED' and ((${table.deferUntil} is not null) <> ${table.deferUntilNextSwitch})) or (${table.reviewState} <> 'DEFERRED' and ${table.deferUntil} is null and ${table.deferUntilNextSwitch} = false)`),
]);

export type AlterProfileRow = typeof alterProfile.$inferSelect;
export type SystemTodoRow = typeof systemTodo.$inferSelect;

// Host is an explicit System role, independent of fronting and coverage.
export const systemHost = pgTable("system_host", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  alterId: uuid("alter_id"),
  version: integer("version").notNull().default(1),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("system_host_one_per_owner").on(table.ownerId),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "system_host_owner_alter_fk" }).onDelete("restrict"),
  check("system_host_positive_version", sql`${table.version} > 0`),
]);


export const pilotPolicy = pgTable("pilot_policy", {
  id: boolean("id").primaryKey().default(true), gateEnabled: boolean("gate_enabled").notNull().default(false),
  friendsEnabled: boolean("friends_enabled").notNull().default(false), invitationsOpen: boolean("invitations_open").notNull().default(false),
  uploadsEnabled: boolean("uploads_enabled").notNull().default(false), maxFriends: integer("max_friends").notNull().default(2),
  capacityVerifiedAt: timestamp("capacity_verified_at",{withTimezone:true}), recoveryVerifiedAt: timestamp("recovery_verified_at",{withTimezone:true}), evidence: text("evidence"),
}, t=>[check("pilot_policy_singleton",sql`${t.id}`),check("pilot_capacity_range",sql`${t.maxFriends} between 0 and 20`)]);
export const pilotAccount = pgTable("pilot_account", {
  ownerId:text("owner_id").primaryKey(), role:text("role").notNull(), state:text("state").notNull().default("ACTIVE"),
  displayName:text("display_name").notNull().default("My system"),quotaBytes:bigint("quota_bytes",{mode:"number"}).notNull().default(52428800),
  privacyAcceptedAt:timestamp("privacy_accepted_at",{withTimezone:true}),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),deletedAt:timestamp("deleted_at",{withTimezone:true}),
},t=>[uniqueIndex("pilot_one_operator").on(t.role).where(sql`${t.role}='OPERATOR'`)]);
export const pilotInvitation=pgTable("pilot_invitation",{
  id:uuid("id").primaryKey().defaultRandom(),tokenHash:text("token_hash").notNull().unique(),email:text("email").notNull(),
  expiresAt:timestamp("expires_at",{withTimezone:true}).notNull(),revokedAt:timestamp("revoked_at",{withTimezone:true}),
  acceptedBy:text("accepted_by").references(()=>pilotAccount.ownerId),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
});

export const alterAppearance = pgTable("alter_appearance", {
  ownerId: text("owner_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  appearanceNotes: text("appearance_notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.alterId] }),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "alter_appearance_owner_alter_fk" }).onDelete("cascade"),
]);

export const alterAppearanceReference = pgTable("alter_appearance_reference", {
  ownerId: text("owner_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  imageId: uuid("image_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.alterId, table.imageId] }),
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "alter_appearance_reference_owner_alter_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.ownerId, table.imageId], foreignColumns: [privateImage.ownerId, privateImage.id], name: "alter_appearance_reference_owner_image_fk" }).onDelete("cascade"),
]);
export const pilotUpload=pgTable("pilot_upload",{
  storageKey:text("storage_key").primaryKey(),ownerId:text("owner_id").notNull().references(()=>pilotAccount.ownerId),bytes:bigint("bytes",{mode:"number"}).notNull(),state:text("state").notNull(),createdAt:timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
},t=>[index("pilot_upload_owner").on(t.ownerId)]);
export const pilotRate=pgTable("pilot_rate",{ownerId:text("owner_id").notNull().references(()=>pilotAccount.ownerId),bucket:text("bucket").notNull(),windowStart:timestamp("window_start",{withTimezone:true}).notNull(),count:integer("count").notNull()},t=>[primaryKey({columns:[t.ownerId,t.bucket]})]);

export const conversationSummary = pgTable("conversation_summary", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  alterId: uuid("alter_id").notNull(),
  startAt: timestamp("start_at", { withTimezone: true }),
  catchUpSessionId: uuid("catch_up_session_id"), revision: integer("revision"),
  generatedAt: timestamp("generated_at", { withTimezone: true }), sourceClient: text("source_client"),
  sourceReferences: jsonb("source_references").notNull().default(sql`'[]'::jsonb`),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  timeZone: text("time_zone").notNull(), summary: text("summary").notNull(), coverage: text("coverage").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '720 hours'`),
}, t => [
  foreignKey({ columns: [t.ownerId, t.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id] }).onDelete("cascade"),
  foreignKey({ columns: [t.ownerId, t.catchUpSessionId], foreignColumns: [catchUpSession.ownerId, catchUpSession.id] }).onDelete("cascade"),
  uniqueIndex("conversation_summary_session_revision").on(t.ownerId, t.catchUpSessionId, t.revision),
  index("conversation_summary_owner_created").on(t.ownerId, t.createdAt.desc()),
  index("conversation_summary_expiry").on(t.expiresAt),
  check("conversation_summary_window", sql`${t.endAt} >= ${t.startAt}`),
  check("conversation_summary_retention", sql`${t.expiresAt} = ${t.createdAt} + interval '720 hours'`),
  check("conversation_summary_body_length", sql`char_length(${t.summary}) between 1 and 20000`),
  check("conversation_summary_coverage_length", sql`char_length(${t.coverage}) between 1 and 4000`),
]);
