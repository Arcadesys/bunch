import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { apiResponse } from "@/server/http-api";
export const runtime = "nodejs";
export async function GET() {
  return apiResponse(async () => {
    const { ownerId } = await requirePilotIdentity();
    const pilot = getPilotService();
    if (await pilot.account(ownerId)) await pilot.rate(ownerId, "export");
    const result = await pilot.export(ownerId);
    return Response.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": 'attachment; filename="diddy-records.json"',
      },
    });
  });
}
