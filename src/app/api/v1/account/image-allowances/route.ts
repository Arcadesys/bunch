import { z } from "zod";
import { apiOwner, apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { ImageAllowanceService } from "@/server/image-allowance";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => Response.json({ data: await new ImageAllowanceService().accounts(await apiOwner(request)) }, { headers: { "Cache-Control": "private, no-store" } }));
}
export async function PATCH(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const operator = await apiOwner(request);
    const input = z.object({ ownerId: z.string().min(1).max(200), limit: z.number().int().min(0).max(1000).nullable() }).strict().parse(await jsonBody(request));
    await new ImageAllowanceService().setLimit(operator, input.ownerId, input.limit);
    return Response.json({ data: { saved: true } });
  });
}
