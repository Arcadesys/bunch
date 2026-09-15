import { getPilotService } from "@/server/pilot-service";
import { NextResponse } from "next/server";
import { requireImageReadCapability } from "@/server/mcp-authorization";
import { readPrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const { imageId } = await params;
    const capability = requireImageReadCapability(request);
    if (capability.imageId !== imageId) throw new Error("Image capability does not match the requested image.");

    await getPilotService().assertAccess(capability.sub, "image");
    const image = await repository.getImage(capability.sub, imageId);
    if (!image) return new NextResponse("Not found", { status: 404 });

    const stored = await readPrivateImage(image.storageKey);
    return new NextResponse(stored.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": stored.contentType,
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        ...(stored.etag ? { ETag: stored.etag } : {}),
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
