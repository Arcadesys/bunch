import { NextResponse } from "next/server";
import { getGalleryShareService } from "@/server/gallery-share-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const notFound = () => new NextResponse("Not found", { status: 404, headers });

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const gallery = await getGalleryShareService().publicGallery((await params).token);
    return gallery ? NextResponse.json(gallery, { headers }) : notFound();
  } catch {
    return notFound();
  }
}
