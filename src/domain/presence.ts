// Hosting and fronting are independent. Hosting is responsibility for the body and is
// held by one profile at a time; fronting episodes describe who is present and may
// overlap. Neither one implies the other, and a missing record never establishes
// absence.

import { z } from "zod";
import { frontingSessionViewSchema, responseMetaSchema, uuidSchema } from "./contracts";

export const presenceKindSchema = z.enum(["HOSTING", "FRONTING"]);
export const presencePeriodSchema = frontingSessionViewSchema.extend({
  kind: presenceKindSchema,
  origin: z.enum(["EXPLICIT", "SYSTEM_HOST_SNAPSHOT"]),
});
export type PresencePeriod = z.infer<typeof presencePeriodSchema>;
export const startFrontingEpisodeSchema = z.object({
  requestId: uuidSchema,
  alterId: uuidSchema,
}).strict();
export const endFrontingEpisodeSchema = z.object({
  requestId: uuidSchema,
  episodeId: uuidSchema,
  expectedVersion: z.number().int().positive(),
}).strict();
export type StartFrontingEpisode = z.infer<typeof startFrontingEpisodeSchema>;
export type EndFrontingEpisode = z.infer<typeof endFrontingEpisodeSchema>;
export const presencePeriodResponseSchema = z.object({ data: presencePeriodSchema, meta: responseMetaSchema });
export const currentPresenceResponseSchema = z.object({
  data: z.object({
    hosting: presencePeriodSchema.nullable(),
    fronting: z.array(presencePeriodSchema),
    legacyCurrentFront: frontingSessionViewSchema.nullable(),
  }),
  meta: responseMetaSchema,
});
