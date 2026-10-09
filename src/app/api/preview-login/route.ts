import { NextResponse } from "next/server";
import { requireSameOrigin } from "@/server/http-api";
import { issuePreviewSession, PREVIEW_SESSION_COOKIE, previewCookieOptions, previewLoginEnabled, previewPasswordMatches, safeReturnTo } from "@/server/preview-login";

export const runtime = "nodejs";

// A relative Location keeps the browser on the host it is already using.
function redirect(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!previewLoginEnabled()) return new NextResponse("Not found", { status: 404 });
  try { requireSameOrigin(request); } catch { return new NextResponse("Forbidden", { status: 403 }); }
  const form = await request.formData().catch(() => null);
  const returnTo = safeReturnTo(form?.get("returnTo") ?? null);
  if (form?.get("action") === "signout") {
    const response = redirect("/preview-login?signedOut=1");
    response.cookies.set(PREVIEW_SESSION_COOKIE, "", previewCookieOptions(0));
    return response;
  }
  const password = form?.get("password");
  if (typeof password !== "string" || !previewPasswordMatches(password)) {
    return redirect(`/preview-login?error=1&returnTo=${encodeURIComponent(returnTo)}`);
  }
  const session = issuePreviewSession();
  const response = redirect(returnTo);
  response.cookies.set(PREVIEW_SESSION_COOKIE, session.value, previewCookieOptions(session.maxAge));
  return response;
}
