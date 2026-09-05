import { z } from "zod";
import { frontingSessionViewSchema, isoTimestampSchema, uuidSchema } from "./contracts";

export const historyKindSchema = z.enum(["HOSTING", "FRONTING", "LEGACY_FRONT"]);
const historyCursorSchema = z.object({ startedAt: isoTimestampSchema, id: uuidSchema, kind: historyKindSchema.default("LEGACY_FRONT") });
export const frontingHistoryQuerySchema = z.object({
  from: isoTimestampSchema.optional().describe("Inclusive interval start, with an explicit UTC offset."),
  to: isoTimestampSchema.optional().describe("Exclusive interval end, with an explicit UTC offset."),
  alterId: uuidSchema.optional(),
  kind: historyKindSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  before: historyCursorSchema.optional().describe("Use nextCursor from the preceding page unchanged."),
}).strict();
export type FrontingHistoryQuery = z.input<typeof frontingHistoryQuerySchema>;
export const frontingHistoryResponseSchema = z.object({
  data: z.array(frontingSessionViewSchema.extend({ kind: historyKindSchema, origin: z.enum(["EXPLICIT", "SYSTEM_HOST_SNAPSHOT", "LEGACY_RECORD"]) })),
  meta: z.object({
    nextCursor: historyCursorSchema.optional(),
    recordedOnly: z.literal(true),
  }),
});
export type FrontingHistoryResponse = z.infer<typeof frontingHistoryResponseSchema>;
