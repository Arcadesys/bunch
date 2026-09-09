import { NextResponse } from "next/server";
import { referenceApi } from "@/server/reference-api";
import { referenceBearer, referenceResponse } from "@/server/reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return referenceResponse(async () => NextResponse.json(await referenceApi.manifest(referenceBearer(request)), {
    headers: { "Cache-Control": "private, no-store" },
  }));
}
