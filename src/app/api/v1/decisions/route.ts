import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getCatchUpService } from "@/server/catch-up-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    return NextResponse.json({ data: await getCatchUpService().listDecisions(ownerId), meta: {} });
  });
}

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const result = await getCatchUpService().createDecision(ownerId, { ...(await jsonBody(request)), requestId } as never, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) }, { status: 201 });
  });
}
