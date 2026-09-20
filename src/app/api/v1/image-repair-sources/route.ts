import { apiOwner, apiResponse } from "@/server/http-api";
import { getNativeSceneService } from "@/server/native-scene-service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => Response.json({ data: await getNativeSceneService().repairs.choices(await apiOwner(request)) }, { headers: { "Cache-Control": "private, no-store" } }));
}
