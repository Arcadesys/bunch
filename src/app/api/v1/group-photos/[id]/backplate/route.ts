import { NextResponse } from "next/server";
import { requireOwnerId } from "@/server/auth";
import { getGroupPhotoService } from "@/server/group-photo-service";
import { readPrivateImage } from "@/server/private-images";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const ownerId = await requireOwnerId(request);
    const { id } = await params;
    const backplate = await getGroupPhotoService().backplate(ownerId, id);
    const stored = await readPrivateImage(backplate.storageKey, { ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
    const response = privateMediaResponse(request, stored, { contentDisposition: "inline" });
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch { return privateMediaError("Not found", 404); }
}
