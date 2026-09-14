import { z } from "zod";
import { uuidSchema } from "./contracts";

export const nativeSceneInputSchema = z
  .object({
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
});
export type NativeSceneRender = z.infer<typeof nativeSceneRenderSchema>;

export const nativeSceneSizes = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
} as const;
