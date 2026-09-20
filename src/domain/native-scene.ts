import { z } from "zod";
import { uuidSchema } from "./contracts";

export const repairSourceSchema = z.object({
  kind: z.enum(["private", "native", "group"]),
  id: uuidSchema,
}).strict();
export type RepairSource = z.infer<typeof repairSourceSchema>;
const plannedRouteSchema = z.object({ model: z.string(), quality: z.enum(["low", "medium", "high"]), label: z.string() });
export const imageAllowanceSchema = z.object({
  limit: z.number().int(), used: z.number().int(), reserved: z.number().int(), remaining: z.number().int(), resetsAt: z.string().datetime(),
  spendTodayUsd: z.number().nonnegative(), softLimitUsd: z.number().positive(), hardLimitUsd: z.number().positive(),
  mode: z.enum(["STANDARD", "ECONOMY", "PAUSED"]), routingStage: z.enum(["off", "shadow", "operator", "pilot"]),
  nextPlannedRoutes: z.object({ promptOnly: plannedRouteSchema, identitySensitive: plannedRouteSchema }),
});
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
  model: z.string(),
  quality: z.enum(["low", "medium", "high"]),
  costMode: z.enum(["STANDARD", "ECONOMY", "PAUSED"]),
  repairSource: repairSourceSchema.optional(),
});
export type NativeSceneRender = z.infer<typeof nativeSceneRenderSchema>;

export const nativeSceneSizes = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
} as const;
