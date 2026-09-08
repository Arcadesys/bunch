import { invitationIdSchema } from "@/domain/tenant-invitations";
import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { apiResponse, requireSameOrigin } from "@/server/http-api";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const identity = await requirePilotIdentity(request);
    const { id } = await params;
    await getPilotService().revokeTenantInvitation(identity.ownerId, invitationIdSchema.parse(id));
    return new Response(null, { status: 204 });
  });
}
