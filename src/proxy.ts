import { NextResponse, type NextRequest } from "next/server";
import { getAuth0Client, isAuth0Configured } from "@/lib/auth0";
import { PREVIEW_SESSION_COOKIE, previewLoginEnabled, verifyPreviewSession } from "@/server/preview-login";

type BrowserAuthClient = {
  middleware(request: NextRequest): Promise<NextResponse>;
  getSession(request: NextRequest): Promise<{ user: { sub?: string } } | null>;
};

const publicPages = new Set([
  "/",
  "/about",
  "/connect",
  "/demo",
  "/install",
  "/join",
  "/welcome",
]);

const publicAssets = new Set([
  "/apple-touch-icon.png",
  "/bunch-barrel-monkeys.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
  "/plural-rings.svg",
]);

export function isPublicBrowserPath(pathname: string) {
  return publicPages.has(pathname)
    || pathname.startsWith("/gallery/share/")
    || pathname.startsWith("/landing/")
    || publicAssets.has(pathname);
}

export function isProtocolPath(pathname: string) {
  return pathname.startsWith("/api/")
    || pathname === "/mcp"
    || pathname.startsWith("/mcp/")
    || pathname.startsWith("/.well-known/");
}

function isLoopback(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function isE2eBrowserRequest(request: NextRequest) {
  if (process.env.SYSTEM_E2E_TEST_MODE !== "true" || !isLoopback(request.nextUrl.hostname)) return false;
  const subject = request.headers.get("x-system-e2e-subject")?.trim();
  return Boolean(subject && /^[A-Za-z0-9|:_-]{1,160}$/.test(subject));
}

// Vercel previews only: Google sign-in cannot complete there, so the test account
// stands in. previewLoginEnabled() is false in production whatever the secret.
function isPreviewRequest(request: NextRequest) {
  if (!previewLoginEnabled()) return false;
  return request.nextUrl.pathname === "/preview-login"
    || verifyPreviewSession(request.cookies.get(PREVIEW_SESSION_COOKIE)?.value) !== null;
}

function previewLoginRedirect(request: NextRequest) {
  const login = new URL("/preview-login", request.url);
  login.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

function authUnavailable() {
  return new NextResponse("Bunch sign-in is temporarily unavailable. Private pages are locked.", {
    status: 503,
    headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function handleBrowserAuth(request: NextRequest, auth0: BrowserAuthClient | null) {
  const pathname = request.nextUrl.pathname;

  if (!auth0) {
    if (isPublicBrowserPath(pathname) || isProtocolPath(pathname) || isE2eBrowserRequest(request) || isPreviewRequest(request)) {
      return NextResponse.next();
    }
    return previewLoginEnabled() ? previewLoginRedirect(request) : authUnavailable();
  }

  const authResponse = await auth0.middleware(request);
  if (pathname.startsWith("/auth/") || isPublicBrowserPath(pathname) || isProtocolPath(pathname) || isE2eBrowserRequest(request)) {
    return authResponse;
  }

  const session = await auth0.getSession(request);
  if (session?.user.sub || isPreviewRequest(request)) return authResponse;
  if (previewLoginEnabled()) return previewLoginRedirect(request);

  const login = new URL("/auth/login", request.url);
  login.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export async function proxy(request: NextRequest) {
  return handleBrowserAuth(request, isAuth0Configured() ? getAuth0Client() : null);
}

export const config = {
  // These widget endpoints authenticate each request with a narrow, short-lived
  // capability. They cannot rely on an Auth0 browser cookie because the
  // ChatGPT iframe is on a different origin.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|api/system/images/inline/|api/system/native-scenes/inline/|api/mcp-image-upload|api/public/gallery/|gallery/share/).*)"],
};
