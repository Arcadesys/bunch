import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { acceptInvitationSchema } from "@/domain/pilot";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const identity = await requirePilotIdentity(request);
    const input = acceptInvitationSchema.parse(await jsonBody(request));
    const account = await getPilotService().accept(
      identity,
      input.token,
      input.displayName,
      input.privacyAccepted,
    );
    return Response.json(
      { data: { state: account.state, displayName: account.display_name } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
