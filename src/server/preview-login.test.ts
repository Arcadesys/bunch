import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { handleBrowserAuth } from "@/proxy";
import { POST } from "@/app/api/preview-login/route";
import { requireOwnerId, requirePilotIdentity } from "./auth";
import { issuePreviewSession, PREVIEW_SESSION_COOKIE, previewLoginEnabled, previewPasswordMatches, safeReturnTo, verifyPreviewSession } from "./preview-login";

const secret = "a".repeat(20) + "-preview-secret-xyz";
const preview = { VERCEL_ENV: "preview", PREVIEW_LOGIN_SECRET: secret };

function withEnv(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  return async () => {
    const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
    Object.assign(process.env, values);
    for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key];
    try { await run(); } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  };
}

test("preview login is on only for Vercel previews with a long secret", () => {
  assert.equal(previewLoginEnabled(preview), true);
  assert.equal(previewLoginEnabled({ ...preview, VERCEL_ENV: "production" }), false, "production never enables it, secret or not");
  assert.equal(previewLoginEnabled({ ...preview, VERCEL_ENV: "development" }), false);
  assert.equal(previewLoginEnabled({ VERCEL_ENV: "preview" }), false);
  assert.equal(previewLoginEnabled({ VERCEL_ENV: "preview", PREVIEW_LOGIN_SECRET: "short" }), false);
  assert.equal(previewLoginEnabled({}), false);
});

test("the password and session cookie are checked strictly", () => {
  assert.equal(previewPasswordMatches(secret, preview), true);
  assert.equal(previewPasswordMatches(`${secret}x`, preview), false);
  assert.equal(previewPasswordMatches("", preview), false);
  assert.equal(previewPasswordMatches(secret, { ...preview, VERCEL_ENV: "production" }), false);

  const now = Date.parse("2026-09-26T12:00:00Z");
  const { value, maxAge } = issuePreviewSession(now, preview);
  assert.equal(maxAge, 12 * 60 * 60);
  assert.equal(verifyPreviewSession(value, now, preview), "preview|tester");
  assert.equal(verifyPreviewSession(value, now + maxAge * 1000 + 1, preview), null, "expired");
  assert.equal(verifyPreviewSession(value, now, { ...preview, PREVIEW_LOGIN_SECRET: `${secret}-rotated` }), null, "rotating the secret signs everyone out");
  assert.equal(verifyPreviewSession(value, now, { ...preview, VERCEL_ENV: "production" }), null);
  const [payload, signature] = value.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "google-oauth2|real-person", exp: 9_999_999_999 })).toString("base64url");
  assert.equal(verifyPreviewSession(`${forged}.${signature}`, now, preview), null, "payload swap");
  assert.equal(verifyPreviewSession(`${payload}.${signature}x`, now, preview), null);
  assert.equal(verifyPreviewSession(`${payload}.${signature}.extra`, now, preview), null);
  assert.equal(verifyPreviewSession(undefined, now, preview), null);
  assert.throws(() => issuePreviewSession(now, {}));
});

test("returnTo stays on this site", () => {
  assert.equal(safeReturnTo("/gallery?x=1"), "/gallery?x=1");
  for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "gallery", null, undefined]) assert.equal(safeReturnTo(value), "/home", String(value));
});

const auth0 = (sub?: string) => ({
  middleware: async () => NextResponse.next(),
  getSession: async () => (sub ? { user: { sub } } : null),
});
const page = (path: string, cookie?: string) => new NextRequest(`https://bunch-git-branch.vercel.app${path}`, { headers: cookie ? { cookie } : {} });

test("on previews the proxy admits the test cookie and sends others to the test sign-in", withEnv(preview, async () => {
  const { value } = issuePreviewSession();
  const signedOut = await handleBrowserAuth(page("/gallery?x=1"), auth0());
  assert.equal(signedOut.status, 307);
  assert.equal(signedOut.headers.get("location"), "https://bunch-git-branch.vercel.app/preview-login?returnTo=%2Fgallery%3Fx%3D1");
  assert.equal((await handleBrowserAuth(page("/preview-login"), auth0())).headers.get("x-middleware-next"), "1");
  assert.equal((await handleBrowserAuth(page("/gallery", `${PREVIEW_SESSION_COOKIE}=${value}`), auth0())).headers.get("x-middleware-next"), "1");
  assert.equal((await handleBrowserAuth(page("/gallery", `${PREVIEW_SESSION_COOKIE}=${value}x`), auth0())).status, 307);
  assert.equal((await handleBrowserAuth(page("/gallery", `${PREVIEW_SESSION_COOKIE}=${value}`), null)).headers.get("x-middleware-next"), "1", "works without Auth0 configured");
}));

test("in production the proxy ignores the test cookie and the sign-in page", withEnv({ ...preview, VERCEL_ENV: "production" }, async () => {
  const forgedWithLeakedSecret = issuePreviewSession(Date.now(), preview).value;
  const response = await handleBrowserAuth(page("/gallery", `${PREVIEW_SESSION_COOKIE}=${forgedWithLeakedSecret}`), auth0());
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /\/auth\/login\?returnTo=%2Fgallery$/);
  assert.match((await handleBrowserAuth(page("/preview-login"), auth0())).headers.get("location") ?? "", /\/auth\/login/);
}));

const form = (fields: Record<string, string>, origin = "https://bunch-git-branch.vercel.app") =>
  new Request("https://bunch-git-branch.vercel.app/api/preview-login", { method: "POST", headers: { origin }, body: new URLSearchParams(fields) });

test("the sign-in route sets a secure cookie only for the right password", withEnv(preview, async () => {
  const ok = await POST(form({ password: secret, returnTo: "/gallery" }));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("location"), "/gallery");
  const cookie = ok.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`^${PREVIEW_SESSION_COOKIE}=`));
  for (const flag of [/HttpOnly/i, /Secure/i, /SameSite=lax/i, /Path=\//i, /Max-Age=43200/i]) assert.match(cookie, flag);

  const bad = await POST(form({ password: "wrong", returnTo: "https://evil.example" }));
  assert.equal(bad.headers.get("location"), "/preview-login?error=1&returnTo=%2Fhome");
  assert.equal(bad.headers.get("set-cookie"), null);

  assert.equal((await POST(form({ password: secret }, "https://evil.example"))).status, 403);
  const out = await POST(form({ action: "signout" }));
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
}));

test("the sign-in route does not exist outside previews", withEnv({ ...preview, VERCEL_ENV: "production" }, async () => {
  assert.equal((await POST(form({ password: secret }))).status, 404);
}));

test("route handlers resolve the preview cookie to the synthetic owner, never a real one", withEnv({ ...preview, AUTH0_DOMAIN: "", AUTH0_CLIENT_ID: "", AUTH0_CLIENT_SECRET: "", AUTH0_SECRET: "" }, async () => {
  const { value } = issuePreviewSession();
  const request = new Request("https://bunch-git-branch.vercel.app/api/v1/account", { headers: { cookie: `other=1; ${PREVIEW_SESSION_COOKIE}=${value}` } });
  assert.deepEqual(await requirePilotIdentity(request), { ownerId: "auth0:preview|tester", email: "preview-tester@bunch.invalid", emailVerified: true });
  await assert.rejects(requirePilotIdentity(new Request("https://bunch-git-branch.vercel.app/api/v1/account")), /Bunch sign-in is temporarily unavailable/);
  await assert.rejects(requireOwnerId(new Request("https://x.example/", { headers: { cookie: `${PREVIEW_SESSION_COOKIE}=${value}x` } })), /temporarily unavailable/);
}));
