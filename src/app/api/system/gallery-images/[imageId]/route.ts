import { requireOwnerId } from "@/server/auth";
import { readPrivateImage } from "@/server/private-images";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const ownerId = await requireOwnerId(request);
    const { imageId } = await params;
    const image = await repository.getImage(ownerId, imageId);
    if (!image) return privateMediaError("Not found", 404);

    const stored = await readPrivateImage(image.storageKey, { ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
    const response = privateMediaResponse(request, stored, { contentDisposition: "inline" });
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return privateMediaError("Not found", 404);
  }
}
