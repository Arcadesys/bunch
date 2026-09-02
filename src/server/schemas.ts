import { z } from "zod";

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(120),
  selfDescribedGender: z.string().trim().max(120).optional().or(z.literal("")),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
});

export const draftSchema = z.object({
  startsOn: z.string().date(),
  endsOn: z.string().date().optional(),
  manualAlterId: z.string().uuid().optional(),
  sharedContext: z.string().trim().max(500).optional(),
}).refine((value) => !value.endsOn || value.endsOn >= value.startsOn, { message: "End date cannot be before the start date." });

export const resolveDraftSchema = z.object({
  draftId: z.string().uuid(),
  result: z.enum(["CONFIRMED", "REJECTED"]),
  alterId: z.string().uuid().optional(),
});

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  alterId: z.string().uuid().optional(),
  coverageId: z.string().uuid().optional(),
  actorAlterId: z.string().uuid().optional(),
});

export const todoSchema = z.object({
  title: z.string().trim().min(1).max(500),
  alterId: z.string().uuid().optional(),
  coverageId: z.string().uuid().optional(),
  status: z.enum(["OPEN", "DONE"]).default("OPEN"),
});

export const preferenceSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(/^[a-z0-9._-]+$/i, "Use letters, numbers, dots, underscores, or hyphens."),
  value: z.string().trim().min(1).max(2000),
});
