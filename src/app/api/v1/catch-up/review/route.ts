import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { ConversationSummaryService } from "@/server/conversation-summary-service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const owner = await apiOwner(request);
    const id = new URL(request.url).searchParams.get("sessionId") ?? "";
    const data = await new ConversationSummaryService().forSession(owner, id);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
