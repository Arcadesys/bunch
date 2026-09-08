import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getGroupPhotoService } from "@/server/group-photo-service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return apiResponse(async () => {
    const ownerId = await apiOwner(request);
    const { id } = await params;
    return NextResponse.json({ data: await getGroupPhotoService().get(ownerId, id), meta: {} });
  });
}
