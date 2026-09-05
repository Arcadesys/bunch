import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
import { endFrontingEpisodeSchema } from "@/domain/presence";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const owner = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const input = endFrontingEpisodeSchema.parse({ ...(await jsonBody(request)), requestId });
    const result = await getSystemService().endFrontingEpisode(owner, input, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) });
  });
}
