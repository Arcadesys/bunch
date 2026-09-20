import { apiOwner, apiResponse } from "@/server/http-api";
import { ImageAllowanceService } from "@/server/image-allowance";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const owner = await apiOwner(request);
    const service = new ImageAllowanceService();
    await service.expire(owner);
    return Response.json({ data: await service.read(owner) }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
