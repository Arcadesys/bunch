import { z } from "zod";
export const acceptInvitationSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    displayName: z.string().trim().min(1).max(120),
    privacyAccepted: z.literal(true),
  })
  .strict();
export const deleteAccountSchema = z
  .object({ confirmation: z.literal("DELETE MY SYSTEM") })
  .strict();
