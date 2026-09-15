import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { apiResponse, requireSameOrigin } from "@/server/http-api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const identity = await requirePilotIdentity(request);
    const invitations = await getPilotService().listTenantInvitations(identity.ownerId);
    const activation = await getPilotService().invitationActivation(identity.ownerId);
    return Response.json({ data: invitations, activation }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const identity = await requirePilotIdentity(request);
    const token = await getPilotService().createTenantInvitation(identity.ownerId);
    return Response.json({ data: { token } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
