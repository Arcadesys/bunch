import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const owner = await apiOwner(request);
    return NextResponse.json({ data: await getSystemService().getCurrentPresence(owner), meta: {} }, { headers: { "Cache-Control": "private, no-store" } });
  });
}
