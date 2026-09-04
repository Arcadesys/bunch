import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
import { getCatchUpService } from "@/server/catch-up-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const result = await getSystemService().switchCurrentFront(ownerId, { ...(await jsonBody(request)), requestId } as never, "WEB");
    const catchUp = await getCatchUpService().openForCurrentFront(ownerId);
    return NextResponse.json({ data: { ...result.data, catchUp }, meta: mutationMeta(requestId, result.replayed) });
  });
}
