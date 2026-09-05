import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireOwnerId } from "@/server/auth";
import { deletePrivateImages, savePrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";
import { getSystemService } from "@/server/system-service";
import { SystemError } from "@/server/system-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ownerId = await requireOwnerId(request);
    const form = await request.formData();
    const file = form.get("image");
    const alterId = form.get("alterId");
    if (!(file instanceof File) || typeof alterId !== "string") throw new Error("Choose a profile and image.");
    const saved = await savePrivateImage(ownerId, file);
    try {
      if (form.get("setAsProfilePicture") === "true") {
        const expectedVersion = Number(form.get("expectedVersion"));
        const requestId = request.headers.get("idempotency-key") ?? String(form.get("requestId") ?? "");
        const result = await getSystemService().attachAndSetProfilePicture(ownerId, alterId, { id: randomUUID(), ...saved }, { expectedVersion, requestId }, "WEB");
        if (result.replayed) await deletePrivateImages([saved.storageKey]);
        return NextResponse.json({ profile: result.data, replayed: result.replayed });
      }
      await repository.attachImage(ownerId, alterId, { id: randomUUID(), ...saved, isProfilePicture: false, createdAt: new Date().toISOString() });
      return NextResponse.json({ image: saved, replayed: false });
    } catch (error) {
      await deletePrivateImages([saved.storageKey]);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload image.";
    const status = error instanceof SystemError ? (error.code === "CONFLICT" ? 409 : error.code === "NOT_FOUND" ? 404 : 400) : message.includes("Sign in") ? 401 : 400;
    return NextResponse.json({ error: error instanceof SystemError ? error.userMessage : message, details: error instanceof SystemError ? error.details : undefined }, { status });
  }
}
