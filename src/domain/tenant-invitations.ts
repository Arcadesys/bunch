import { z } from "zod";

export const invitationIdSchema = z.string().uuid();

export const openTenantInvitationsSchema = z.object({
  checkedAt: z.string().datetime(),
  slots: z.union([z.literal(3), z.literal(4)]),
  capacityConfirmed: z.literal(true),
  recoveryConfirmed: z.literal(true),
  capacityEvidence: z.string().trim().min(12).max(2000),
  recoveryEvidence: z.string().trim().min(12).max(2000),
}).strict();
