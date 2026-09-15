import { getPilotService } from "@/server/pilot-service";
import { SystemError } from "@/server/system-error";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireImageUploadCapability } from "@/server/mcp-authorization";
import { savePrivateImage, deletePrivateImages } from "@/server/private-images";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const capability = requireImageUploadCapability(request);
    await getPilotService().assertAccess(capability.sub, "upload");
    if (!await repository.listProfiles(capability.sub).then(profiles => profiles.some(p => p.id === capability.alterId))) throw new Error("Profile not found.");
    const form = await request.formData();
    const file = form.get("image");
    const alterId = form.get("alterId");
    if (!(file instanceof File) || alterId !== capability.alterId) throw new Error("Image upload does not match the authorized profile.");
    const saved = await savePrivateImage(capability.sub, file);
    try { await repository.attachImage(capability.sub, capability.alterId, { id: randomUUID(), ...saved }); }
    catch(error) { await deletePrivateImages([saved.storageKey]); throw error; }
    return NextResponse.json({ stored: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to store private image.";
    return NextResponse.json({ error: message }, { status: error instanceof SystemError ? error.code === "RATE_LIMITED" ? 429 : error.code === "QUOTA_EXCEEDED" ? 413 : 403 : 401 });
  }
}
