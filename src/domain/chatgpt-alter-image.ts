import { z } from "zod";

const supportedImageMimeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);

/** The file object supplied by a ChatGPT host for the user's scene image. */
export const chatgptSceneImageSchema = z.object({
  download_url: z.string().url(),
  file_id: z.string().trim().min(1).max(500),
  mime_type: supportedImageMimeSchema.optional(),
  file_name: z.string().trim().min(1).max(255).optional(),
}).strict();

/** Input for preparing private Bunch references for a ChatGPT image turn. */
export const chatgptAlterImageInputSchema = z.object({
  scene: z.string().trim().min(1).max(5000),
  alterNames: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  sceneImage: chatgptSceneImageSchema,
}).strict();

export const chatgptAlterImageResultSchema = z.object({
  ready: z.literal(true),
  status: z.literal("READY"),
  scene: z.string(),
  identities: z.array(z.object({
    alterName: z.string(),
    referenceCount: z.number().int().positive(),
  }).strict()),
  referenceCount: z.number().int().positive(),
}).strict();

export type ChatgptAlterImageInput = z.infer<typeof chatgptAlterImageInputSchema>;
export type ChatgptAlterImageResult = z.infer<typeof chatgptAlterImageResultSchema>;
