import { NextResponse, type NextRequest } from "next/server";
import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";

export async function proxy(request: NextRequest) {
  if (!isAuth0Configured()) return NextResponse.next();
  return getAuth0Client().middleware(request);
}

export const config = {
  // These widget endpoints authenticate each request with a narrow, short-lived
  // capability. They cannot rely on an Auth0 browser cookie because the
  // ChatGPT iframe is on a different origin.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/system/images/inline/|api/mcp-image-upload|api/public/gallery/|gallery/share/).*)"],
};
