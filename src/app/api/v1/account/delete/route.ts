import { del } from "@vercel/blob";
import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { deleteAccountSchema } from "@/domain/pilot";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    deleteAccountSchema.parse(await jsonBody(request));
    const { ownerId } = await requirePilotIdentity();
    const pilot = getPilotService();
    await pilot.beginDeletion(ownerId);
    try {
      const result = await pilot.finishDeletion(ownerId, async (keys) => {
        if (keys.length) await del(keys);
      });
      return Response.json(
        { data: result },
        {
          status: result.state === "DELETED" ? 200 : 202,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    } catch {
      return Response.json(
        {
          data: { state: "DELETING", retryable: true },
          message:
            "Access is stopped. File deletion needs another attempt. Retry here or contact the operator.",
        },
        { status: 202, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  });
}
