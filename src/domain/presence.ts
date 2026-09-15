// Hosting and fronting are independent. Hosting is responsibility for the body and is
// held by one profile at a time; fronting episodes describe who is present and may
// overlap. Neither one implies the other, and a missing record never establishes
// absence.

import { z } from "zod";
import { frontingSessionViewSchema, responseMetaSchema, uuidSchema } from "./contracts";

export const presenceKindSchema = z.enum(["HOSTING", "FRONTING"]);
// Energy and trigger are reported after a switch is recorded and are omitted
// when unreported; a missing value never means "none".
export const presenceEnergySchema = z.number().int().min(1).max(5);
export const presenceTriggerSchema = z.string().trim().min(1).max(60);
export const presencePeriodSchema = frontingSessionViewSchema.extend({
  kind: presenceKindSchema,
  origin: z.enum(["EXPLICIT", "SYSTEM_HOST_SNAPSHOT"]),
  energy: presenceEnergySchema.optional(),
  trigger: z.string().optional(),
});
export type PresencePeriod = z.infer<typeof presencePeriodSchema>;
export const recordPresenceDetailsSchema = z.object({
  requestId: uuidSchema,
  periodId: uuidSchema,
  expectedVersion: z.number().int().positive(),
  energy: presenceEnergySchema.nullable(),
  trigger: presenceTriggerSchema.nullable(),
}).strict();
export type RecordPresenceDetails = z.infer<typeof recordPresenceDetailsSchema>;
// Undo removes a just-recorded change instead of recording an opposite one, so a
// mistaken tap never becomes someone's last recorded arrival or departure.
export const PRESENCE_RETRACT_WINDOW_MINUTES = 15;
export const retractPresenceChangeSchema = z.object({
  requestId: uuidSchema,
  changeRequestId: uuidSchema,
}).strict();
export type RetractPresenceChange = z.infer<typeof retractPresenceChangeSchema>;
export const presenceRetractionSchema = z.object({
  retracted: z.enum(["HOST_CHANGE", "FRONTING_START", "FRONTING_END"]),
  periodId: uuidSchema.optional(),
});
export type PresenceRetraction = z.infer<typeof presenceRetractionSchema>;
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
