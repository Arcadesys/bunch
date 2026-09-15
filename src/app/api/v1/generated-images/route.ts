import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { listGeneratedPhotos } from "@/server/generated-gallery";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const page = await listGeneratedPhotos(ownerId, new URL(request.url).searchParams.get("cursor"));
    return NextResponse.json(page, { headers: { "Cache-Control": "private, no-store" } });
  });
}
