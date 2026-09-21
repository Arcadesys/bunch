import { requireOwnerId } from "@/server/auth";
import { readPrivateImage } from "@/server/private-images";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ storageKey: string[] }> }) {
  try {
    const ownerId = await requireOwnerId(request);
    const { storageKey: storageKeyParts } = await params;
    const storageKey = storageKeyParts.join("/");
    if (!(await repository.ownsImage(ownerId, storageKey))) return privateMediaError("Not found", 404);
    const image = await readPrivateImage(storageKey, { ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
    return privateMediaResponse(request, image);
  } catch {
    return privateMediaError("Not found", 404);
  }
}
