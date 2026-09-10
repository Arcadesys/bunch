import { NextResponse } from "next/server";
import { z } from "zod";
import { uuidSchema } from "@/domain/contracts";
import { arrangeActionSchema } from "@/domain/group-photo";
import { apiOwner, apiResponse, jsonBody, requireSameOrigin } from "@/server/http-api";
import { getGroupPhotoService } from "@/server/group-photo-service";

export const runtime = "nodejs";
const inputSchema = z.object({ alterId: uuidSchema, action: arrangeActionSchema, expectedVersion: z.number().int().positive() });
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const ownerId = await apiOwner(request);
    const { id } = await params;
    const input = inputSchema.parse(await jsonBody(request));
    const project = await getGroupPhotoService().arrange(ownerId, id, input.alterId, input.action, input.expectedVersion);
    return NextResponse.json({ data: project, meta: {} });
  });
}
