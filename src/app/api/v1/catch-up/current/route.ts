import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getCatchUpService } from "@/server/catch-up-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const data = await getCatchUpService().openForPresence(ownerId, new URL(request.url).searchParams.get("periodId") ?? undefined);
    return NextResponse.json({ data, meta: {} });
  });
}
