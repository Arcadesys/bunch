import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireFurryResultUploadCapability } from "@/server/mcp-authorization";
import { getPilotService } from "@/server/pilot-service";
import { deletePrivateImages, savePrivateImage } from "@/server/private-images";
import { SystemError } from "@/server/system-error";
import { getSystemService } from "@/server/system-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const capability = requireFurryResultUploadCapability(request);
    await getPilotService().assertAccess(capability.sub, "upload");
    const form = await request.formData();
    const file = form.get("image");
    const alterId = form.get("alterId");
    if (!(file instanceof File) || alterId !== capability.alterId) throw new Error("Generated result does not match the authorized profile.");
    const contentHash = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
    const service = getSystemService();
    // Validate current ownership even for a replay, so a stale capability cannot
    // retrieve or recreate a keeper for an erased or foreign profile.
    await service.getAlter(capability.sub, capability.alterId);
    const replay = await service.findGeneratedGalleryResult(capability.sub, capability.alterId, capability.requestId, contentHash);
    if (replay) return NextResponse.json({ stored: true, replayed: true, profilePictureChanged: false });

    const saved = await savePrivateImage(capability.sub, file);
    try {
      const result = await service.saveGeneratedGalleryResult(
        capability.sub, capability.alterId, { id: randomUUID(), ...saved },
        { requestId: capability.requestId, contentHash }, "SYSTEM",
      );
      // A concurrent identical retry can win after the preflight. Its extra
      // Blob is never referenced, so remove it before replying.
      if (result.replayed) await deletePrivateImages([saved.storageKey]);
      return NextResponse.json({ stored: true, replayed: result.replayed, profilePictureChanged: false });
    } catch (error) {
      await deletePrivateImages([saved.storageKey]);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to store generated result.";
    const status = error instanceof SystemError
      ? error.code === "CONFLICT" ? 409 : error.code === "NOT_FOUND" ? 404 : error.code === "RATE_LIMITED" ? 429 : error.code === "QUOTA_EXCEEDED" ? 413 : 403
      : 401;
    return NextResponse.json({ error: error instanceof SystemError ? error.userMessage : message }, { status });
  }
}
