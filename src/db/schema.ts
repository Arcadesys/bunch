import {
  boolean,
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

export const appUser = pgTable("app_user", {
  id: text("id").primaryKey(),
  googleSubject: text("google_subject").notNull().unique(),
  timeZone: text("time_zone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alterProfile = pgTable("alter_profile", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  pronouns: text("pronouns"),
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
  uniqueIndex("private_image_one_profile_picture").on(table.ownerId, table.alterId).where(sql`${table.isProfilePicture} = true`),
]);

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

export const catchUpSession = pgTable("catch_up_session", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull().references(() => appUser.id, { onDelete: "cascade" }),
  frontingSessionId: uuid("fronting_session_id").notNull(),
  alterId: uuid("alter_id").notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  firstTime: boolean("first_time").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("catch_up_session_owner_id_id_key").on(table.ownerId, table.id),
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
