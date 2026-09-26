// A test account for Vercel preview deployments, where Google sign-in cannot finish
// because Auth0 only allows the production callback URL.
//
// It is off unless BOTH hold: Vercel marks the deployment as a preview
// (VERCEL_ENV=preview, which production never is) and PREVIEW_LOGIN_SECRET is at
// least 32 characters. The account is one synthetic subject that Google sign-in can
// never issue, so owner scoping keeps it away from every real account's records even
// when a preview shares the production database.

import { createHmac, timingSafeEqual } from "node:crypto";

export const PREVIEW_SESSION_COOKIE = "bunch_preview_session";
export const PREVIEW_SUBJECT = "preview|tester";
export const PREVIEW_EMAIL = "preview-tester@bunch.invalid";
const sessionSeconds = 12 * 60 * 60;

type Env = { VERCEL_ENV?: string; PREVIEW_LOGIN_SECRET?: string; [key: string]: string | undefined };

export function previewLoginEnabled(env: Env = process.env) {
  return env.VERCEL_ENV === "preview" && (env.PREVIEW_LOGIN_SECRET?.length ?? 0) >= 32;
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(`bunch-preview-session:${payload}`).digest("base64url");
}

function sameBytes(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Constant-time check of the typed password against PREVIEW_LOGIN_SECRET. */
export function previewPasswordMatches(candidate: string, env: Env = process.env) {
  if (!previewLoginEnabled(env)) return false;
  // Compare fixed-length digests so the secret's length does not leak through timing.
  const digest = (value: string) => createHmac("sha256", "bunch-preview-password").update(value).digest("base64url");
  return sameBytes(digest(candidate), digest(env.PREVIEW_LOGIN_SECRET!));
}

export function issuePreviewSession(now = Date.now(), env: Env = process.env) {
  if (!previewLoginEnabled(env)) throw new Error("Preview login is not enabled.");
  const payload = Buffer.from(JSON.stringify({ sub: PREVIEW_SUBJECT, exp: Math.floor(now / 1000) + sessionSeconds })).toString("base64url");
  return { value: `${payload}.${sign(payload, env.PREVIEW_LOGIN_SECRET!)}`, maxAge: sessionSeconds };
}

/** Returns the preview subject for a valid, unexpired cookie; null otherwise or when disabled. */
export function verifyPreviewSession(token: string | undefined, now = Date.now(), env: Env = process.env): string | null {
  if (!token || !previewLoginEnabled(env)) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!sameBytes(signature, sign(payload, env.PREVIEW_LOGIN_SECRET!))) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    if (claims.sub !== PREVIEW_SUBJECT || typeof claims.exp !== "number" || claims.exp * 1000 <= now) return null;
    return PREVIEW_SUBJECT;
  } catch { return null; }
}

export function previewCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge };
}

/** Only same-site paths; absolute and protocol-relative URLs fall back to /home. */
export function safeReturnTo(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/home";
}
