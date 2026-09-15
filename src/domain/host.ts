import { z } from "zod";
import { uuidSchema, responseMetaSchema } from "./contracts";

export const setSystemHostSchema = z.object({
  requestId: uuidSchema,
  alterId: uuidSchema.nullable(),
  expectedVersion: z.number().int().positive().nullable(),
}).strict();

// Null data means never recorded; null alterId means explicitly cleared.
export const systemHostViewSchema = z.object({
  id: uuidSchema,
  alterId: uuidSchema.nullable(),
  alterName: z.string().nullable(),
  version: z.number().int().positive(),
  recordedAt: z.string().datetime(),
});
export const systemHostResponseSchema = z.object({ data: systemHostViewSchema.nullable(), meta: responseMetaSchema });
export type SetSystemHost = z.infer<typeof setSystemHostSchema>;
export type SystemHostView = z.infer<typeof systemHostViewSchema>;
