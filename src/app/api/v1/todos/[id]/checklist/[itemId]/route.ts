import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
type Context = { params: Promise<{ id: string; itemId: string }> };
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: Context) { return apiResponse(async () => { requireSameOrigin(request); const ownerId = await apiOwner(request); const requestId = idempotencyKey(request); const { id, itemId } = await params; const result = await getSystemService().updateChecklistItem(ownerId, id, itemId, { ...(await jsonBody(request)), requestId } as never, "WEB"); return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) }); }); }
export async function DELETE(request: Request, { params }: Context) { return apiResponse(async () => { requireSameOrigin(request); const ownerId = await apiOwner(request); const requestId = idempotencyKey(request); const { id, itemId } = await params; const result = await getSystemService().eraseChecklistItem(ownerId, id, itemId, { ...(await jsonBody(request)), requestId } as never, "WEB"); return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) }); }); }
