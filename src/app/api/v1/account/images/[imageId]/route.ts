import { apiResponse, requireSameOrigin } from "@/server/http-api";
import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { repository } from "@/server/repository";
import { readPrivateImage } from "@/server/private-images";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";
import { uuidSchema } from "@/domain/contracts";
import { getImageDeletionService } from "@/server/image-deletion";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  try {
    const { ownerId } = await requirePilotIdentity();
    const pilot = getPilotService();
    const account = await pilot.account(ownerId);
    if (!account || !["ACTIVE", "REVOKED"].includes(account.state))
      return new Response("Unavailable", { status: 403 });
    await pilot.rate(ownerId, "image");
    const imageId = uuidSchema.parse((await params).imageId);
    const image = await repository.getImage(ownerId, imageId);
    if (!image) return new Response("Not found", { status: 404 });
    const stored = await readPrivateImage(image.storageKey, { ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
    return privateMediaResponse(request, stored, { contentDisposition: `attachment; filename="${imageId}"` });
  } catch {
    return privateMediaError("Unavailable", 403);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const { ownerId } = await requirePilotIdentity(request);
    const imageId = uuidSchema.parse((await params).imageId);
    // Retrying an already-deleted image still succeeds.
    await getImageDeletionService().delete(ownerId, "upload", imageId);
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
