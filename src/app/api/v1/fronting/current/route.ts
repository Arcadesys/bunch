import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const data = await getSystemService().getCurrentFront(ownerId);
    return NextResponse.json({ data, meta: {} });
  });
}
