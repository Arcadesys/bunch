import { handleMcpRequest } from "@/server/mcp-http";
import { after } from "next/server";
import { getNativeSceneService } from "@/server/native-scene-service";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) { return handleMcpRequest(request); }
export async function POST(request: Request) {
  return handleMcpRequest(request, undefined, (ownerId, renderId) => after(async () => {
    await getNativeSceneService().process(ownerId, renderId).catch(() => console.error("[native-scene] processing unavailable"));
  }));
}
export async function DELETE(request: Request) { return handleMcpRequest(request); }
