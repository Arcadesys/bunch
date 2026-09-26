import { NextResponse } from "next/server";
import { defaultStickerSlots, saveStickerPackSchema } from "@/domain/sticker-pack";
import {
  apiOwner,
  apiResponse,
  idempotencyKey,
  jsonBody,
  mutationMeta,
  requireSameOrigin,
} from "@/server/http-api";
import { getStickerPackService } from "@/server/sticker-pack-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const data = await getStickerPackService().get(ownerId, id);
    return NextResponse.json(
      { data, meta: { defaults: defaultStickerSlots() } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function PUT(request: Request, { params }: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const requestId = idempotencyKey(request);
    const input = saveStickerPackSchema.parse({ ...(await jsonBody(request)), requestId });
    const result = await getStickerPackService().save(ownerId, id, input, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) });
  });
}
