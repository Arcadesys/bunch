import { NextResponse } from "next/server";
import { requireOwnerId } from "@/server/auth";
import { getGroupPhotoService } from "@/server/group-photo-service";
import { readPrivateImage } from "@/server/private-images";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const ownerId = await requireOwnerId(request);
    const { id } = await params;
    const backplate = await getGroupPhotoService().backplate(ownerId, id);
    const stored = await readPrivateImage(backplate.storageKey);
    return new NextResponse(stored.body, { headers: { "Cache-Control": "private, no-store", "Content-Disposition": "inline", "Content-Type": stored.contentType, "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", ...(stored.etag ? { ETag: stored.etag } : {}) } });
  } catch { return new NextResponse("Not found", { status: 404 }); }
}
