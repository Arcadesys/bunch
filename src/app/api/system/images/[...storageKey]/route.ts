import { NextResponse } from "next/server";
import { requireOwnerId } from "@/server/auth";
import { readPrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ storageKey: string[] }> }) {
  try {
    const ownerId = await requireOwnerId(request);
    const { storageKey: storageKeyParts } = await params;
    const storageKey = storageKeyParts.join("/");
    if (!(await repository.ownsImage(ownerId, storageKey))) return new NextResponse("Not found", { status: 404 });
    const image = await readPrivateImage(storageKey);
    return new NextResponse(image.body, { headers: { "Cache-Control": "private, no-cache", "Content-Type": image.contentType, "X-Content-Type-Options": "nosniff", ...(image.etag ? { ETag: image.etag } : {}) } });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
