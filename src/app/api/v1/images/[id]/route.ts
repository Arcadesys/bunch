import { NextResponse } from "next/server";
import { apiOwner } from "@/server/http-api";
import { readPrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const image = await repository.getImage(ownerId, id);
    if (!image) return new NextResponse("Not found", { status: 404 });

    const stored = await readPrivateImage(image.storageKey);
    return new NextResponse(stored.body, {
      headers: {
        "Cache-Control": "private, no-store",
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
