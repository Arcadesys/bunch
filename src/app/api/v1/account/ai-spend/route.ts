import { z } from "zod";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getMcpUsageService } from "@/server/mcp-usage-service";
import { getPilotService } from "@/server/pilot-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const operator = await apiOwner(request);
    await getPilotService().assertOperator(operator);
    const value = new URL(request.url).searchParams.get("windowDays") ?? "30";
    const windowDays = z.coerce.number().int().min(1).max(90).parse(value);
    return Response.json({ data: (await getMcpUsageService().summary(windowDays)).aiSpend }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
