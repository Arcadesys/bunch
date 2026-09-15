import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const requestId = idempotencyKey(request);
    const result = await getSystemService().setAlterAppearance(ownerId, id, { ...(await jsonBody(request)), requestId } as never, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) });
  });
}
