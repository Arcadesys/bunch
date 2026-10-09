import { NextResponse } from "next/server";
import { stickerPackDraftSchema, defaultStickerPack } from "@/domain/sticker-pack";
import { apiOwner, apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { repository } from "@/server/repository";
import { getSystemService } from "@/server/system-service";
import { SystemError } from "@/server/system-error";

type Context = { params: Promise<{ alterId: string }> };
export const runtime = "nodejs";

function key(alterId: string) { return `stickers.v1.${alterId}`; }

async function assertAlter(ownerId: string, alterId: string) {
  const alter = await getSystemService().getAlter(ownerId, alterId);
  if (!alter || alter.archivedAt) throw new SystemError("NOT_FOUND", "Person not found.");
  return alter;
}

export async function GET(request: Request, { params }: Context) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const { alterId } = await params;
    await assertAlter(ownerId, alterId);
    const saved = (await repository.listPreferences(ownerId)).find(item => item.key === key(alterId));
    if (!saved) return NextResponse.json({ data: defaultStickerPack(alterId), meta: {} }, { headers: { "Cache-Control": "private, no-store" } });
    try {
      const data = stickerPackDraftSchema.parse(JSON.parse(saved.value));
      return NextResponse.json({ data: { ...data, updatedAt: saved.updatedAt }, meta: {} }, { headers: { "Cache-Control": "private, no-store" } });
    } catch {
      return NextResponse.json({ data: defaultStickerPack(alterId), meta: { recovered: true } }, { headers: { "Cache-Control": "private, no-store" } });
    }
  });
}

export async function PUT(request: Request, { params }: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const { alterId } = await params;
    await assertAlter(ownerId, alterId);
    const parsed = stickerPackDraftSchema.safeParse(await jsonBody(request));
    if (!parsed.success || parsed.data.alterId !== alterId) throw new SystemError("VALIDATION_ERROR", "Sticker pack draft is invalid.", parsed.success ? undefined : parsed.error.flatten());
    const saved = await repository.savePreference(ownerId, key(alterId), JSON.stringify(parsed.data));
    return NextResponse.json({ data: { ...parsed.data, updatedAt: saved.updatedAt }, meta: {} }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
