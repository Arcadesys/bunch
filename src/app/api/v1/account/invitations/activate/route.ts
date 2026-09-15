import { openTenantInvitationsSchema } from "@/domain/tenant-invitations";
import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const identity = await requirePilotIdentity(request);
    const input = openTenantInvitationsSchema.parse(await jsonBody(request));
    await getPilotService().openTenantInvitations(identity.ownerId, input);
    return Response.json({ data: { open: true } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
