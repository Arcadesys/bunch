import { NextResponse } from "next/server";
import { requireOwnerId } from "@/server/auth";
import { requireSameOrigin } from "@/server/http-api";
import { referenceApi } from "@/server/reference-api";
import { referenceResponse } from "@/server/reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return referenceResponse(async () => NextResponse.json({ data: await referenceApi.list(await requireOwnerId(request)) }, { headers: { "Cache-Control": "private, no-store" } }));
}

export async function POST(request: Request) {
  return referenceResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await requireOwnerId(request);
    const body = await request.json() as { label?: unknown; selectedAlterIds?: unknown };
    const result = await referenceApi.issue(ownerId, {
      label: typeof body.label === "string" ? body.label : "",
      selectedAlterIds: Array.isArray(body.selectedAlterIds) ? body.selectedAlterIds.filter((id): id is string => typeof id === "string") : [],
    });
    return NextResponse.json({ data: result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
