import { referenceApi } from "@/server/reference-api";
import { referenceBearer, referenceResponse } from "@/server/reference-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ imageId: string }> };

export async function GET(request: Request, { params }: Context) {
  return referenceResponse(async () => {
    const { imageId } = await params;
    const image = await referenceApi.image(referenceBearer(request), imageId);
    return new Response(image.bytes, { headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, no-store",
      "ETag": `\"${image.sha256}\"`,
      "X-Reference-Version": String(image.version),
    } });
  });
}
