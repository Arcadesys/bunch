import { z } from "zod";
import { uuidSchema } from "./contracts";

export const repairSourceSchema = z.object({
  kind: z.enum(["private", "native", "group"]),
  id: uuidSchema,
}).strict();
export type RepairSource = z.infer<typeof repairSourceSchema>;
export const imageAllowanceSchema = z.object({ limit: z.number().int(), used: z.number().int(), reserved: z.number().int(), remaining: z.number().int(), resetsAt: z.string().datetime() });
export type ImageAllowance = z.infer<typeof imageAllowanceSchema>;

export const nativeSceneInputSchema = z
  .object({
    repairSource: repairSourceSchema.optional(),
    scene: z.string().trim().min(1).max(5000),
    alterNames: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    requestId: uuidSchema,
    format: z.enum(["square", "landscape", "portrait"]).default("square"),
  })
  .strict();
export type NativeSceneInput = z.infer<typeof nativeSceneInputSchema>;

export const nativeSceneRenderSchema = z.object({
  id: uuidSchema,
  scene: z.string(),
  alterNames: z.array(z.string()),
  state: z.enum(["QUEUED", "RUNNING", "COMPLETE", "FAILED"]),
  createdAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  contentHash: z.string().nullable(),
  repairSource: repairSourceSchema.optional(),
});
export type NativeSceneRender = z.infer<typeof nativeSceneRenderSchema>;

export const nativeSceneSizes = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
} as const;
