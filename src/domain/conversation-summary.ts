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
export const conversationSummarySchema = summaryInput.omit({ requestId: true }).extend({
  id: uuidSchema, createdAt: isoTimestampSchema, expiresAt: isoTimestampSchema,
});
export const listConversationSummariesSchema = z.object({
  alterId: uuidSchema.optional(),
  before: isoTimestampSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
