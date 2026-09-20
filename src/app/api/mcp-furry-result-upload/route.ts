import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(_request: Request) {
  return NextResponse.json(
    { error: "FURRY_IMAGE_STUDIO_DISABLED: Bunch does not integrate with Furry Image Studio." },
    { status: 410 },
  );
}
