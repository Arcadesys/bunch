import { NextResponse } from "next/server";
import { apiOwner, apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { getGroupPhotoService } from "@/server/group-photo-service";
import { SystemError } from "@/server/system-error";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const body = await jsonBody(request);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new SystemError("VALIDATION_ERROR", "A current project version is required.");
    const { id } = await params;
    const project = await getGroupPhotoService().savePlacement(ownerId, id, body, expectedVersion);
    return NextResponse.json({ data: project, meta: {} });
  });
}
