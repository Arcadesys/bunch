import { after, NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getNativeSceneService } from "@/server/native-scene-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const service = getNativeSceneService();
    const render = await service.get(ownerId, (await params).id);
    if (render.state === "QUEUED") after(() => service.process(ownerId, render.id).catch(() => console.error("[native-scene] processing unavailable")));
    return NextResponse.json({ data: render, meta: {} }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
