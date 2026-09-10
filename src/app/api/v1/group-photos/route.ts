import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { apiOwner, apiResponse, requireSameOrigin } from "@/server/http-api";
import { deletePrivateImages, savePrivateImage } from "@/server/private-images";
import { getGroupPhotoService } from "@/server/group-photo-service";
import { SystemError } from "@/server/system-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const form = await request.formData();
    const file = form.get("backplate");
    if (!(file instanceof File)) throw new SystemError("VALIDATION_ERROR", "Choose a JPEG, PNG, or WebP backplate.");
    const saved = await savePrivateImage(ownerId, file);
    try {
      const project = await getGroupPhotoService().create(ownerId, { storageKey: saved.storageKey, contentType: saved.contentType });
      return NextResponse.json({ data: project, meta: { requestId: randomUUID(), replayed: false } }, { status: 201 });
    } catch (error) {
      await deletePrivateImages([saved.storageKey]);
      throw error;
    }
  });
}

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    return NextResponse.json({ data: await getGroupPhotoService().list(ownerId), meta: { finisherAvailable: Boolean(process.env.OPENAI_API_KEY?.trim()) } }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
