import { NextResponse } from "next/server";
import { appearanceInputSchema, defaultAppearance, validateAppearance, type AppearanceDocument } from "@/domain/appearance";
import { apiOwner, apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { repository } from "@/server/repository";
import { SystemError } from "@/server/system-error";

export const runtime = "nodejs";
const key = "appearance.v1";

async function read(owner: string): Promise<AppearanceDocument> {
  const saved = (await repository.listPreferences(owner)).find(preference => preference.key === key);
  if (!saved) return defaultAppearance;
  try {
    const parsed = appearanceInputSchema.parse(JSON.parse(saved.value));
    return { ...parsed, updatedAt: saved.updatedAt };
  } catch { return defaultAppearance; }
}

export async function GET(request: Request) {
  return apiResponse(async () => NextResponse.json({ data: await read(await apiOwner(request)), meta: {} }, { headers: { "Cache-Control": "private, no-store" } }));
}

export async function PUT(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const owner = await apiOwner(request);
    const parsed = appearanceInputSchema.safeParse(await jsonBody(request));
    if (!parsed.success) throw new SystemError("VALIDATION_ERROR", "Choose a valid Bunch color scheme.", parsed.error.flatten());
    const failures = validateAppearance(parsed.data);
    if (failures.length) throw new SystemError("VALIDATION_ERROR", "This color scheme does not yet meet accessible contrast.", { failures });
    const saved = await repository.savePreference(owner, key, JSON.stringify(parsed.data));
    return NextResponse.json({ data: { ...parsed.data, updatedAt: saved.updatedAt }, meta: {} }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
