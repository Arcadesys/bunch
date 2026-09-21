import { NextResponse } from "next/server";
import { uuidSchema } from "@/domain/contracts";
import { getGalleryShareService } from "@/server/gallery-share-service";
import { readPrivateImage } from "@/server/private-images";
import {
  addSharedGalleryImageCacheTags,
  matchesSharedGalleryEtag,
  matchesSharedGalleryLastModified,
  sharedGalleryEdgeCacheRequested,
  sharedGalleryImageEtag,
  sharedGalleryImageHeaders,
  sharedGalleryTokenCacheIdentity,
} from "@/server/shared-gallery-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" };
const notFound = () => new NextResponse("Not found", { status: 404, headers });

export async function GET(request: Request, { params }: { params: Promise<{ token: string; imageId: string }> }) {
  try {
    const { token, imageId } = await params;
    const image = await getGalleryShareService().publicImage(token, uuidSchema.parse(imageId));
    if (!image) return notFound();
    const identity = sharedGalleryTokenCacheIdentity(token, imageId);
    const etag = sharedGalleryImageEtag(image.shareId ?? identity, image.storageKey);
    const lastModified = new Date(image.createdAt ?? Date.now());
    if (!Number.isFinite(lastModified.getTime())) return notFound();
    const edgeCacheEnabled = sharedGalleryEdgeCacheRequested()
      ? await addSharedGalleryImageCacheTags(image.shareId ?? identity, imageId)
      : false;
    const responseHeaders = { ...sharedGalleryImageHeaders(etag, lastModified, edgeCacheEnabled), "Content-Type": image.contentType };
    const ifNoneMatch = request.headers.get("if-none-match");
    const notModified = ifNoneMatch !== null
      ? matchesSharedGalleryEtag(ifNoneMatch, etag)
      : matchesSharedGalleryLastModified(request.headers.get("if-modified-since"), lastModified);
    if (notModified) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }
    const stored = await readPrivateImage(image.storageKey);
    return new NextResponse(stored.body, { headers: responseHeaders });
  } catch {
    return notFound();
  }
}
