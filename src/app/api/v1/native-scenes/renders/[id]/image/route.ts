import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getNativeSceneService } from "@/server/native-scene-service";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const stored = await getNativeSceneService().image(await apiOwner(request), (await params).id);
    return new NextResponse(stored.body, { headers: { "Content-Type": stored.contentType, "Cache-Control": "private, no-store", "Content-Disposition": "inline; filename=private-scene.jpg", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  });
}
