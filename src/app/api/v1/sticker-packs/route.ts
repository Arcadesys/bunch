import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getStickerPackService } from "@/server/sticker-pack-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const data = await getStickerPackService().list(ownerId);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
