import { NextResponse } from "next/server";
import { uuidSchema } from "@/domain/contracts";
import { getGalleryShareService } from "@/server/gallery-share-service";
import { readPrivateImage } from "@/server/private-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "cross-origin" };
const notFound = () => new NextResponse("Not found", { status: 404, headers });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; imageId: string }> }) {
  try {
    const { token, imageId } = await params;
    const image = await getGalleryShareService().publicImage(token, uuidSchema.parse(imageId));
    if (!image) return notFound();
    const stored = await readPrivateImage(image.storageKey);
    return new NextResponse(stored.body, { headers: { ...headers, "Content-Type": stored.contentType, ...(stored.etag ? { ETag: stored.etag } : {}) } });
  } catch {
    return notFound();
  }
}
