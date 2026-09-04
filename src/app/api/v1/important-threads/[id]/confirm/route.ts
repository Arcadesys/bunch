import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getCatchUpService } from "@/server/catch-up-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const { id } = await context.params;
    const body = await jsonBody(request);
    const result = await getCatchUpService().confirmThread(ownerId, id, Number(body.expectedVersion), requestId, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) });
  });
}
