import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/domain/contracts";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
type Context = { params: Promise<{ id: string }> };
const schema = z.object({ alterId: uuidSchema.nullable(), expectedVersion: z.number().int().positive() }).strict();
export const runtime = "nodejs";
export async function PATCH(request: Request, { params }: Context) { return apiResponse(async () => { requireSameOrigin(request); const ownerId = await apiOwner(request); const requestId = idempotencyKey(request); const input = schema.parse(await jsonBody(request)); const { id } = await params; const result = await getSystemService().setNoteAlter(ownerId, id, input.alterId, input.expectedVersion, requestId, "WEB"); return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) }); }); }
