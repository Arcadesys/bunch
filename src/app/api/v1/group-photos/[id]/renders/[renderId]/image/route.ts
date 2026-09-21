import { requireOwnerId } from "@/server/auth";
import { getGroupPhotoRenderService } from "@/server/group-photo-render-service";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; renderId: string }> }) {
  try {
    const ownerId = await requireOwnerId(request);
    const { id, renderId } = await params;
    const stored = await getGroupPhotoRenderService().image(ownerId, id, renderId, request.headers.get("if-none-match") ?? undefined);
    const response = privateMediaResponse(request, stored, { contentDisposition: "inline; filename=group-photo.jpg" });
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch { return privateMediaError("Not found", 404); }
}
