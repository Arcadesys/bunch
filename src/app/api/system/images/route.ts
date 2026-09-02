import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireOwnerId } from "@/server/auth";
import { savePrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ownerId = await requireOwnerId(request);
    const form = await request.formData();
    const file = form.get("image");
    const alterId = form.get("alterId");
    if (!(file instanceof File) || typeof alterId !== "string") throw new Error("Choose a profile and image.");
    const saved = await savePrivateImage(ownerId, file);
    await repository.attachImage(ownerId, alterId, { id: randomUUID(), ...saved });
    return NextResponse.json({ image: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload image.";
    return NextResponse.json({ error: message }, { status: message.includes("Sign in") ? 401 : 400 });
  }
}
