import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, parseBoolean, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const data = await getSystemService().getAlter(ownerId, id, parseBoolean(new URL(request.url).searchParams.get("includeArchived")));
    return NextResponse.json({ data, meta: {} });
  });
}

export async function PATCH(request: Request, { params }: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const { id } = await params;
    const result = await getSystemService().updateAlter(ownerId, id, { ...(await jsonBody(request)), requestId } as never, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) });
  });
}

export async function DELETE(request: Request, { params }: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const { id } = await params;
    const result = await getSystemService().eraseAlter(ownerId, id, { ...(await jsonBody(request)), requestId } as never, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) });
  });
}
