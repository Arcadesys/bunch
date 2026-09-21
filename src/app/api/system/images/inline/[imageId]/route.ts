import { getPilotService } from "@/server/pilot-service";
import { NextResponse } from "next/server";
import { requireImageReadCapability } from "@/server/mcp-authorization";
import { readPrivateImage } from "@/server/private-images";
import { privateMediaError } from "@/server/private-media-response";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export function privateInlineImageHeaders(contentType: string, etag?: string) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "private, no-store",
    "Vercel-CDN-Cache-Control": "no-store",
    "Content-Type": contentType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    ...(etag ? { ETag: etag } : {}),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const capability = requireImageReadCapability(request);
    const { imageId } = await params;
    if (capability.imageId !== imageId) throw new Error("Image capability does not match the requested image.");

    await getPilotService().assertAccess(capability.sub, "image");
    const image = await repository.getImage(capability.sub, imageId);
    if (!image) return privateMediaError("Not found", 404);

    const stored = await readPrivateImage(image.storageKey);
    return new NextResponse(stored.body, {
      headers: privateInlineImageHeaders(stored.contentType, stored.etag),
    });
  } catch {
    return privateMediaError("Not found", 404);
  }
}
