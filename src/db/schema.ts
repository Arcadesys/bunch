import {
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ columns: [table.ownerId, table.alterId], foreignColumns: [alterProfile.ownerId, alterProfile.id], name: "private_image_owner_alter_fk" }).onDelete("cascade"),
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

export type AlterProfileRow = typeof alterProfile.$inferSelect;
export type SystemTodoRow = typeof systemTodo.$inferSelect;
