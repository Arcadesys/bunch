import { apiOwner } from "@/server/http-api";
import { readPrivateImage } from "@/server/private-images";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";
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
    if (!image) return privateMediaError("Not found", 404);

    const stored = await readPrivateImage(image.storageKey, { ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
    const response = privateMediaResponse(request, stored);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return privateMediaError("Not found", 404);
  }
}
