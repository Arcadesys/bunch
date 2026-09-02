import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireImageUploadCapability } from "@/server/mcp-authorization";
import { savePrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const capability = requireImageUploadCapability(request);
    const form = await request.formData();
    const file = form.get("image");
    const alterId = form.get("alterId");
    if (!(file instanceof File) || alterId !== capability.alterId) throw new Error("Image upload does not match the authorized profile.");
    const saved = await savePrivateImage(capability.sub, file);
    await repository.attachImage(capability.sub, capability.alterId, { id: randomUUID(), ...saved });
    return NextResponse.json({ stored: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to store private image.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
