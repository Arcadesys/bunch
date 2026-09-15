import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export async function GET(request: Request, { params }: Context) { return apiResponse(async () => { const ownerId = await apiOwner(request); const { id } = await params; return NextResponse.json({ data: await getSystemService().getNote(ownerId, id), meta: {} }); }); }
export async function PATCH(request: Request, { params }: Context) { return apiResponse(async () => { requireSameOrigin(request); const ownerId = await apiOwner(request); const requestId = idempotencyKey(request); const { id } = await params; const result = await getSystemService().updateNote(ownerId, id, { ...(await jsonBody(request)), requestId } as never, "WEB"); return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) }); }); }
export async function DELETE(request: Request, { params }: Context) { return apiResponse(async () => { requireSameOrigin(request); const ownerId = await apiOwner(request); const requestId = idempotencyKey(request); const { id } = await params; const result = await getSystemService().eraseNote(ownerId, id, { requestId, ...(await jsonBody(request)) } as never, "WEB"); return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) }); }); }
