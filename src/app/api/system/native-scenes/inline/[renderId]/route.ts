import { NextResponse } from "next/server";
import { requireSceneImageReadCapability } from "@/server/mcp-authorization";
import { getNativeSceneService } from "@/server/native-scene-service";
import { getPilotService } from "@/server/pilot-service";

export const runtime = "nodejs";

// The scene widget renders in a host iframe on another origin, so the owner comes
// from a short-lived render-scoped capability rather than a session cookie.
export async function GET(request: Request, { params }: { params: Promise<{ renderId: string }> }) {
  try {
    const { renderId } = await params;
    const capability = requireSceneImageReadCapability(request);
    if (capability.renderId !== renderId) throw new Error("Scene capability does not match the requested render.");

    await getPilotService().assertAccess(capability.sub, "image");
    const stored = await getNativeSceneService().image(capability.sub, renderId);
    return new NextResponse(stored.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": stored.contentType,
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
