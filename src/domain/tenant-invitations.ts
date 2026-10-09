import { z } from "zod";

export const invitationIdSchema = z.string().uuid();

export const openTenantInvitationsSchema = z.object({
  checkedAt: z.string().datetime(),
  slots: z.number().int().min(1).max(20),
  capacityConfirmed: z.literal(true),
  recoveryConfirmed: z.literal(true),
  capacityEvidence: z.string().trim().min(12).max(2000),
  recoveryEvidence: z.string().trim().min(12).max(2000),
}).strict();
