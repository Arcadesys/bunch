import { after, NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, requireSameOrigin } from "@/server/http-api";
import { nativeSceneInputSchema } from "@/domain/native-scene";
import { getNativeSceneService } from "@/server/native-scene-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const service = getNativeSceneService();
    const renders = await service.list(ownerId);
    for (const render of renders.filter(render => render.state === "QUEUED")) after(() => service.process(ownerId, render.id).catch(() => console.error("[native-scene] processing unavailable")));
    return NextResponse.json({ data: renders, meta: { available: service.isAvailable() } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const input = nativeSceneInputSchema.parse({ ...await jsonBody(request), requestId: idempotencyKey(request) });
    const service = getNativeSceneService();
    const render = await service.start(ownerId, input);
    if (render.state === "QUEUED") after(() => service.process(ownerId, render.id).catch(() => console.error("[native-scene] processing unavailable")));
    return NextResponse.json({ data: render, meta: { available: service.isAvailable() } }, { status: render.state === "COMPLETE" ? 200 : 202 });
  });
}
