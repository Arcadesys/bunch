import { createHash } from "node:crypto";
import { z } from "zod";
import { COMPANION_SCOPE } from "./mcp-authorization";

export const ACCOUNT_PROFILE_TOOL_NAME = "get_account_profile";

export const accountProfileSchema = z.object({
  id: z.string().min(1).regex(/\S/).describe("Opaque profile identifier, unique within Bunch and unchanged across token refresh, reconnection, and display-metadata changes. Never reassigned to another profile."),
  name: z.string().describe("Display name for the authenticated Bunch profile.").optional(),
  email: z.string().email().describe("Email address for display; not used as the profile identity.").optional(),
  nickname: z.string().describe("A useful label that helps distinguish connected Bunch profiles.").optional(),
}).strict();

export const accountProfileTool = {
  title: "Get connected Bunch account",
  description: "Read the stable, non-sensitive profile for the Bunch account authorized by this connection. Use it to distinguish connected accounts; it never accepts an owner ID and never exposes the authentication subject.",
  inputSchema: z.object({}).strict(),
  outputSchema: accountProfileSchema,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: {
    "openai/profile": true,
    securitySchemes: [{ type: "oauth2" as const, scopes: [COMPANION_SCOPE] }],
  },
};

export function accountProfileId(ownerId: string) {
  return `bunch_${createHash("sha256").update("bunch-account-profile\0").update(ownerId).digest("base64url").slice(0, 24)}`;
}
