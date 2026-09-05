import { NextResponse } from "next/server";
import {
  apiOwner,
  apiResponse,
  idempotencyKey,
  jsonBody,
  mutationMeta,
  requireSameOrigin,
} from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
import { setSystemHostSchema } from "@/domain/host";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return apiResponse(async () =>
    NextResponse.json(
      {
        data: await getSystemService().getSystemHost(await apiOwner(request)),
        meta: {},
      },
      { headers: { "Cache-Control": "private, no-store" } },
    ),
  );
}
export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const owner = await apiOwner(request);
    const requestId = idempotencyKey(request);
    const input = setSystemHostSchema.parse({
      ...(await jsonBody(request)),
      requestId,
    });
    const result = await getSystemService().setSystemHost(owner, input, "WEB");
    return NextResponse.json({
      data: result.data,
      meta: mutationMeta(requestId, result.replayed),
    });
  });
}
