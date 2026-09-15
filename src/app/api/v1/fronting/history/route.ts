import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const params = new URL(request.url).searchParams;
    const result = await getSystemService().listFrontingHistory(ownerId, {
      from: params.get("from") ?? undefined, to: params.get("to") ?? undefined,
      kind: params.get("kind") as "HOSTING" | "FRONTING" | "LEGACY_FRONT" | undefined || undefined,
      alterId: params.get("alterId") ?? undefined,
      limit: params.has("limit") ? Number(params.get("limit")) : undefined,
      before: params.has("beforeStartedAt") || params.has("beforeId")
        ? { startedAt: params.get("beforeStartedAt") ?? "", id: params.get("beforeId") ?? "", kind: (params.get("beforeKind") ?? "LEGACY_FRONT") as "HOSTING" | "FRONTING" | "LEGACY_FRONT" } : undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  });
}
