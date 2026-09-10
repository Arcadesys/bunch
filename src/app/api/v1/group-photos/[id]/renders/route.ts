import { after, NextResponse } from "next/server";
import { z } from "zod";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, requireSameOrigin } from "@/server/http-api";
import { getGroupPhotoRenderService } from "@/server/group-photo-render-service";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const { expectedVersion } = z.object({ expectedVersion: z.number().int().positive() }).parse(await jsonBody(request));
    const service = getGroupPhotoRenderService();
    const render = await service.start(ownerId, id, expectedVersion, idempotencyKey(request));
    if (render.state === "QUEUED") after(() => service.process(ownerId, render.id).catch(() => { console.error("[group-photo] processing unavailable"); }));
    return NextResponse.json({ data: render, meta: {} }, { status: render.state === "COMPLETE" ? 200 : 202 });
  });
}
