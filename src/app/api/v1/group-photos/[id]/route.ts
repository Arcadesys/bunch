import { getGroupPhotoRenderService } from "@/server/group-photo-render-service";
import { after, NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getGroupPhotoService } from "@/server/group-photo-service";

export const runtime = "nodejs";
export const maxDuration = 300;
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const project = await getGroupPhotoService().get(ownerId, id);
    const service = getGroupPhotoRenderService();
    const renders = await service.list(ownerId, id);
    for (const render of renders.filter(r => r.state === "QUEUED")) after(() => service.process(ownerId, render.id).catch(() => { console.error("[group-photo] processing unavailable"); }));
    return NextResponse.json({ data: { ...project, renders }, meta: {} }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
