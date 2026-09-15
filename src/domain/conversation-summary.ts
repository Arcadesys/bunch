import { z } from "zod";
import { isoTimestampSchema, uuidSchema } from "./contracts";
import { ianaTimeZoneSchema } from "./catch-up";

const summaryInput = z.object({
  requestId: uuidSchema,
  alterId: uuidSchema,
  startAt: isoTimestampSchema,
  endAt: isoTimestampSchema,
  timeZone: ianaTimeZoneSchema,
  summary: z.string().trim().min(1).max(20000),
  coverage: z.string().trim().min(1).max(4000),
}).strict();
export const saveConversationSummarySchema = summaryInput.refine(v => Date.parse(v.endAt) >= Date.parse(v.startAt), {
  path: ["endAt"], message: "endAt must be on or after startAt.",
});
// "DIDDY" is a frozen persisted literal meaning "a record stored in Bunch". Stored
// rows are re-parsed through this schema on every read, and cached ChatGPT tool
// descriptors still send it, so narrowing or renaming it breaks reads of existing
// data and rejects older clients. It is never shown to anyone: the UI renders it
// as "Bunch record".
export const conversationSummarySchema = summaryInput.omit({ requestId: true }).extend({
  startAt: isoTimestampSchema.nullable(),
  catchUpSessionId: uuidSchema.nullish(), revision: z.number().int().positive().nullish(),
  generatedAt: isoTimestampSchema.nullish(), sourceClient: z.string().nullish(),
  sourceReferences: z.array(z.object({ kind: z.enum(["DIDDY", "MEMORY", "CONVERSATION"]), reference: z.string().max(1000) })).optional(),
  id: uuidSchema, createdAt: isoTimestampSchema, expiresAt: isoTimestampSchema,
});
export const listConversationSummariesSchema = z.object({
  alterId: uuidSchema.optional(),
  before: isoTimestampSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export const saveEpisodeReviewSchema = z.object({
  version: z.literal(1), requestId: uuidSchema, catchUpSessionId: uuidSchema, alterId: uuidSchema,
  expectedRevision: z.number().int().min(0), generatedAt: isoTimestampSchema,
  sourceClient: z.string().trim().min(1).max(100), timeZone: ianaTimeZoneSchema,
  overview: z.string().trim().min(1).max(6000), attentionNow: z.string().trim().min(1).max(6000),
  significantChanges: z.string().trim().min(1).max(6000), coverage: z.string().trim().min(1).max(4000),
  sourceReferences: z.array(z.object({ kind: z.enum(["DIDDY", "MEMORY", "CONVERSATION"]), reference: z.string().trim().min(1).max(1000) }).strict()).max(200),
}).strict();
