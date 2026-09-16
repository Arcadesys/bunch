import { NextResponse } from "next/server";
import { requireOwnerId } from "@/server/auth";
import { requireSameOrigin } from "@/server/http-api";
import { referenceApi, ReferenceValidationError } from "@/server/reference-api";
import { referenceResponse } from "@/server/reference-http";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Context) {
  return referenceResponse(async () => {
    requireSameOrigin(request);
    const { id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new ReferenceValidationError("Credential ID is invalid.");
    const revoked = await referenceApi.revoke(await requireOwnerId(request), id);
    if (!revoked) throw new ReferenceValidationError("Credential was not found.");
    return NextResponse.json({ data: { revoked: true } }, { headers: { "Cache-Control": "no-store" } });
  });
}
