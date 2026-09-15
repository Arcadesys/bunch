import { NextResponse } from "next/server";
import { apiOwner, apiResponse, idempotencyKey, jsonBody, mutationMeta, requireSameOrigin } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
import { recordPresenceDetailsSchema } from "@/domain/presence";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const owner = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const { id } = await params;
    const input = recordPresenceDetailsSchema.parse({ ...(await jsonBody(request)), periodId: id, requestId });
    const result = await getSystemService().recordPresenceDetails(owner, input, "WEB");
    return NextResponse.json({ data: result.data, meta: mutationMeta(requestId, result.replayed) });
  });
}
