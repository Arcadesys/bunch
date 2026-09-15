import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, parseLimit, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const query = new URL(request.url).searchParams;
    const page = await getSystemService().listNotes(ownerId, { cursor: query.get("cursor") ?? undefined, limit: parseLimit(query.get("limit")), alterId: query.get("alterId") ?? undefined, actorAlterId: query.get("actorAlterId") ?? undefined });
    return NextResponse.json({ data: page.data, meta: { nextCursor: page.nextCursor } });
  });
}

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const result = await getSystemService().createNote(ownerId, { ...(await jsonBody(request)), requestId } as never, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) }, { status: result.replayed ? 200 : 201 });
  });
}
