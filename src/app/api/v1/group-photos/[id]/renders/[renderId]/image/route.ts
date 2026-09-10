import { NextResponse } from "next/server";
import { requireOwnerId } from "@/server/auth";
import { getGroupPhotoRenderService } from "@/server/group-photo-render-service";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; renderId: string }> }) {
  try {
    const ownerId = await requireOwnerId(request);
    const { id, renderId } = await params;
    const stored = await getGroupPhotoRenderService().image(ownerId, id, renderId);
    return new NextResponse(stored.body, { headers: { "Content-Type": stored.contentType, "Cache-Control": "private, no-store", "Content-Disposition": "inline; filename=group-photo.jpg", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch { return new NextResponse("Not found", { status: 404 }); }
}
