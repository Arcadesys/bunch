import { NextResponse } from "next/server";
import { ReferenceAuthorizationError, ReferenceValidationError } from "@/server/reference-api";

export function referenceBearer(request: Request) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ") || value.length <= 7) throw new ReferenceAuthorizationError("A reference credential is required.");
  return value.slice(7);
}

export async function referenceResponse(run: () => Promise<Response>) {
  try { return await run(); } catch (error) {
    if (error instanceof ReferenceAuthorizationError) return NextResponse.json({ error: "Unauthorized reference credential." }, { status: 401 });
    if (error instanceof ReferenceValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && (/sign in|cross-origin|unauthorized/i.test(error.message))) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    console.error("Reference API request failed", error);
    return NextResponse.json({ error: "Reference API request failed." }, { status: 500 });
  }
}
