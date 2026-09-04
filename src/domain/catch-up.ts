import { z } from "zod";
import { isoTimestampSchema, uuidSchema } from "@/domain/contracts";

export const catchUpItemTypeSchema = z.enum(["NOTE", "TODO", "DECISION", "THREAD"]);
export const catchUpReviewStateSchema = z.enum(["NEW", "ACKNOWLEDGED", "DEFERRED", "RESOLVED"]);
export const importantThreadSourceSchema = z.enum(["CODEX", "CHATGPT"]);
export const importantThreadStatusSchema = z.enum(["SUGGESTED", "CONFIRMED", "ARCHIVED"]);

export const catchUpItemSchema = z.object({
  entryId: uuidSchema,
  itemType: catchUpItemTypeSchema,
  itemId: uuidSchema,
  title: z.string(),
  whyItMatters: z.string(),
  fromLabel: z.string(),
  toLabel: z.string(),
  timestamp: isoTimestampSchema,
  statusLabel: z.string().optional(),
  dueOn: z.string().date().optional(),
  nextAction: z.string(),
  reviewState: catchUpReviewStateSchema,
  deferUntil: isoTimestampSchema.optional(),
  deferUntilNextSwitch: z.boolean().optional(),
  version: z.number().int().positive(),
  threadSource: importantThreadSourceSchema.optional(),
  threadUrl: z.string().url().optional(),
});

export const catchUpSessionSchema = z.object({
  id: uuidSchema,
  alterId: uuidSchema,
  alterName: z.string(),
  startedAt: isoTimestampSchema,
  windowStart: isoTimestampSchema.optional(),
  windowEnd: isoTimestampSchema,
  firstTime: z.boolean(),
  items: z.array(catchUpItemSchema),
  reviewedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  stateVersion: z.number().int().nonnegative(),
});

export const setCatchUpItemStateSchema = z.object({
  requestId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  state: catchUpReviewStateSchema,
  deferUntil: isoTimestampSchema.optional(),
  deferUntilNextSwitch: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.state === "DEFERRED" && !value.deferUntil && !value.deferUntilNextSwitch) {
    context.addIssue({ code: "custom", path: ["deferUntil"], message: "Choose when this item should return." });
  }
  if (value.state === "DEFERRED" && value.deferUntil && value.deferUntilNextSwitch) {
    context.addIssue({ code: "custom", path: ["deferUntil"], message: "Choose one return time." });
  }
});

export const importantThreadCreateSchema = z.object({
  requestId: uuidSchema,
  source: importantThreadSourceSchema,
  externalThreadId: z.string().trim().min(1).max(500),
  url: z.string().url(),
  title: z.string().trim().min(1).max(500),
  approvedSummary: z.string().trim().min(1).max(5000),
  keyDecisionOrAction: z.string().trim().min(1).max(5000),
  flaggedByAlterId: uuidSchema.optional(),
  recipientAlterIds: z.array(uuidSchema).max(100).default([]),
}).strict();

export const systemDecisionCreateSchema = z.object({
  requestId: uuidSchema,
  title: z.string().trim().min(1).max(500),
  decision: z.string().trim().min(1).max(5000),
  rationale: z.string().trim().max(5000).optional(),
  nextAction: z.string().trim().min(1).max(5000),
  actorAlterId: uuidSchema.optional(),
  recipientAlterIds: z.array(uuidSchema).max(100).default([]),
}).strict();

export type CatchUpItemType = z.infer<typeof catchUpItemTypeSchema>;
export type CatchUpReviewState = z.infer<typeof catchUpReviewStateSchema>;
export type CatchUpItem = z.infer<typeof catchUpItemSchema>;
export type CatchUpSession = z.infer<typeof catchUpSessionSchema>;
export type SetCatchUpItemState = z.infer<typeof setCatchUpItemStateSchema>;
export type ImportantThreadCreate = z.infer<typeof importantThreadCreateSchema>;
export type SystemDecisionCreate = z.infer<typeof systemDecisionCreateSchema>;
