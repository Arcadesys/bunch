import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { handleBrowserAuth, isE2eBrowserRequest, isProtocolPath, isPublicBrowserPath } from "./proxy";

function request(path: string, headers?: HeadersInit) {
  return new NextRequest(`http://127.0.0.1:3217${path}`, { headers });
}

test("public and protocol routes are classified narrowly", () => {
  for (const path of ["/", "/about", "/welcome", "/demo", "/install", "/connect", "/join", "/gallery/share/token", "/bunch-barrel-monkeys.png", "/manifest.webmanifest"]) {
    assert.equal(isPublicBrowserPath(path), true, path);
  }
  for (const path of ["/home", "/board", "/profiles", "/gallery", "/gallery/generated", "/about/private", "/private/data.json"]) {
    assert.equal(isPublicBrowserPath(path), false, path);
  }
  for (const path of ["/api/v1/alters", "/api/public/gallery/token", "/mcp", "/mcp/stream", "/.well-known/oauth-protected-resource"]) {
    assert.equal(isProtocolPath(path), true, path);
  }
  assert.equal(isProtocolPath("/mcprivate"), false);
});

test("missing Auth0 configuration fails private pages closed but leaves public and protocol routes available", async () => {
  assert.equal((await handleBrowserAuth(request("/home"), null)).status, 503);
  assert.equal((await handleBrowserAuth(request("/auth/login"), null)).status, 503);
  assert.equal((await handleBrowserAuth(request("/demo"), null)).headers.get("x-middleware-next"), "1");
  assert.equal((await handleBrowserAuth(request("/api/v1/alters"), null)).headers.get("x-middleware-next"), "1");
});

test("configured Auth0 redirects signed-out private pages and preserves a relative return path", async () => {
  const auth0 = {
    middleware: async () => NextResponse.next(),
    getSession: async () => null,
  };
  const privateRequest = request("/board?due=today&view=list");
  const response = await handleBrowserAuth(privateRequest, auth0);
  assert.equal(response.status, 307);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin, privateRequest.nextUrl.origin);
  assert.equal(location.pathname, "/auth/login");
  assert.equal(location.searchParams.get("returnTo"), "/board?due=today&view=list");
});

test("configured Auth0 passes authenticated, public, API, and auth-route requests", async () => {
  let sessions = 0;
  const auth0 = {
    middleware: async () => NextResponse.next(),
    getSession: async () => { sessions += 1; return { user: { sub: "google-oauth2|owner" } }; },
  };
  for (const path of ["/home", "/", "/api/v1/alters", "/auth/callback"]) {
    const response = await handleBrowserAuth(request(path), auth0);
    assert.equal(response.headers.get("x-middleware-next"), "1", path);
  }
  assert.equal(sessions, 1);
});

test("the browser-test bypass requires loopback, the explicit flag, and a valid subject header", () => {
  const previous = process.env.SYSTEM_E2E_TEST_MODE;
  try {
    process.env.SYSTEM_E2E_TEST_MODE = "true";
    assert.equal(isE2eBrowserRequest(request("/home", { "x-system-e2e-subject": "fixture-owner" })), true);
    assert.equal(isE2eBrowserRequest(request("/home")), false);
    assert.equal(isE2eBrowserRequest(new NextRequest("https://system.thearcades.me/home", { headers: { "x-system-e2e-subject": "fixture-owner" } })), false);
  } finally {
    if (previous === undefined) delete process.env.SYSTEM_E2E_TEST_MODE;
    else process.env.SYSTEM_E2E_TEST_MODE = previous;
  }
});
