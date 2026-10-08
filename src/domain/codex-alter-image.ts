import { z } from "zod";
import { furrySceneInputSchema } from "./image-prompt";
import { uuidSchema } from "./contracts";

export const codexAlterImageInputSchema = furrySceneInputSchema;

export const codexAlterImageResultSchema = z.object({
  status: z.literal("REFERENCE_DOWNLOAD_REQUIRED"),
  scene: z.string(),
  prompt: z.string(),
  references: z.array(z.object({
    alterId: uuidSchema,
    alterName: z.string(),
    imageId: uuidSchema,
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    galleryUrl: z.string().url(),
    downloadUrl: z.string().url(),
  }).strict()).min(1).max(12),
  providerCalled: z.literal(false),
  allowanceCharged: z.literal(false),
  saved: z.literal(false),
}).strict();
