import { NextResponse } from "next/server";
import { requireOwnerId } from "@/server/auth";
import { readPrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const ownerId = await requireOwnerId(request);
    const { imageId } = await params;
    const image = await repository.getImage(ownerId, imageId);
    if (!image) return new NextResponse("Not found", { status: 404 });

    const stored = await readPrivateImage(image.storageKey);
    return new NextResponse(stored.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "Content-Type": stored.contentType,
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        ...(stored.etag ? { ETag: stored.etag } : {}),
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
