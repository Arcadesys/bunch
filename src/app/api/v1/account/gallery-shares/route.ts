import { NextResponse } from "next/server";
import { galleryShareCreateSchema } from "@/domain/contracts";
import { apiOwner, apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { getGalleryShareService } from "@/server/gallery-share-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const data = await getGalleryShareService().list(ownerId);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const { duration } = galleryShareCreateSchema.parse(await jsonBody(request));
    const created = await getGalleryShareService().create(ownerId, duration);
    const url = new URL(`/gallery/share/${created.token}`, request.url).toString();
    return NextResponse.json({ data: { ...created.share, token: created.token, url } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  });
}
