import { apiOwner, apiResponse } from "@/server/http-api";
import { getNativeSceneService } from "@/server/native-scene-service";
import { privateMediaResponse } from "@/server/private-media-response";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const stored = await getNativeSceneService().image(await apiOwner(request), (await params).id, request.headers.get("if-none-match") ?? undefined);
    const response = privateMediaResponse(request, stored, { contentDisposition: "inline; filename=private-scene.jpg" });
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  });
}
