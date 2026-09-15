import { NextResponse } from "next/server";
import { galleryShareFrontingSchema, uuidSchema } from "@/domain/contracts";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, requireSameOrigin } from "@/server/http-api";
import { getGalleryShareService } from "@/server/gallery-share-service";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    idempotencyKey(request);
    const id = uuidSchema.parse((await params).id);
    const revoked = await getGalleryShareService().revoke(ownerId, id);
    return NextResponse.json({ data: { revoked } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const id = uuidSchema.parse((await params).id);
    const { showCurrentFronting } = galleryShareFrontingSchema.parse(await jsonBody(request));
    const data = await getGalleryShareService().setCurrentFronting(ownerId, id, showCurrentFronting);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
