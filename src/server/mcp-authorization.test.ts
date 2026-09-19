import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ownerIdFromAuth0Subject } from "@/server/auth";
import { COMPANION_SCOPE, getMcpAuthorizationConfig, issueImageReadCapability, issueSceneImageReadCapability, mcpWwwAuthenticate, requireCompanionAccessToken, requireImageReadCapability, requireSceneImageReadCapability, verifyCompanionAccessToken, type McpAuthorizationConfig } from "@/server/mcp-authorization";
import { SystemError } from "@/server/system-error";

const config: McpAuthorizationConfig = {
  issuer: "https://tenant.example.auth0.com/",
  audience: "https://system.example/mcp",
  acceptedAudiences: ["https://system.example/mcp"],
  jwksUri: new URL("https://tenant.example.auth0.com/.well-known/jwks.json"),
};

async function fixtureToken(overrides: { audience?: string; scope?: string; expiresIn?: string } = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const token = await new SignJWT({ scope: overrides.scope ?? COMPANION_SCOPE })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("google-oauth2|immutable-google-subject")
    .setIssuer(config.issuer)
    .setAudience(overrides.audience ?? config.audience)
    .setIssuedAt()
    .setExpirationTime(overrides.expiresIn ?? "5m")
    .sign(privateKey);
  return { token, getKey: async () => publicKey, publicJwk };
}

test("web sessions and MCP tokens map the same Auth0 subject to one owner", async () => {
  const { token, getKey } = await fixtureToken();
  const ownerId = await verifyCompanionAccessToken(token, config, getKey);
  assert.equal(ownerId, ownerIdFromAuth0Subject("google-oauth2|immutable-google-subject"));
});

test("MCP JWT verification rejects the wrong resource audience", async () => {
  const { token, getKey } = await fixtureToken({ audience: "https://other.example/mcp" });
  await assert.rejects(() => verifyCompanionAccessToken(token, config, getKey), /aud/i);
});

test("MCP JWT verification accepts a configured legacy resource audience", async () => {
  const legacyAudience = "https://system-arcades-me.vercel.app/mcp";
  const { token, getKey } = await fixtureToken({ audience: legacyAudience });
  const ownerId = await verifyCompanionAccessToken(token, {
    ...config,
    acceptedAudiences: [config.audience, legacyAudience],
  }, getKey);
  assert.equal(ownerId, ownerIdFromAuth0Subject("google-oauth2|immutable-google-subject"));
});

test("MCP JWT verification rejects the wrong issuer", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const token = await new SignJWT({ scope: COMPANION_SCOPE })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("google-oauth2|immutable-google-subject")
    .setIssuer("https://other-tenant.example.auth0.com/")
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
  await assert.rejects(() => verifyCompanionAccessToken(token, config, async () => publicKey), /iss/i);
});

test("MCP JWT verification rejects a token without the companion scope", async () => {
  const { token, getKey } = await fixtureToken({ scope: "openid email" });
  await assert.rejects(() => verifyCompanionAccessToken(token, config, getKey), /companion scope/i);
});

test("legacy resource URLs are normalized, unique, and validation-only", () => {
  const original = {
    AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
    MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL,
    MCP_LEGACY_RESOURCE_URLS: process.env.MCP_LEGACY_RESOURCE_URLS,
    SYSTEM_PUBLIC_ORIGIN: process.env.SYSTEM_PUBLIC_ORIGIN,
  };
  process.env.AUTH0_DOMAIN = "tenant.example.auth0.com";
  process.env.MCP_RESOURCE_URL = "https://system.thearcades.me/mcp";
  process.env.MCP_LEGACY_RESOURCE_URLS = " https://system-arcades-me.vercel.app/mcp/ , https://system-arcades-me.vercel.app/mcp, https://system.thearcades.me/mcp ";
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://system.thearcades.me";
  try {
    const authorization = getMcpAuthorizationConfig();
    assert.equal(authorization.audience, "https://system.thearcades.me/mcp");
    assert.deepEqual(authorization.acceptedAudiences, ["https://system.thearcades.me/mcp", "https://system-arcades-me.vercel.app/mcp"]);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("OAuth challenges keep advertising the canonical resource metadata", () => {
  const original = {
    MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL,
    MCP_LEGACY_RESOURCE_URLS: process.env.MCP_LEGACY_RESOURCE_URLS,
    SYSTEM_PUBLIC_ORIGIN: process.env.SYSTEM_PUBLIC_ORIGIN,
  };
  process.env.MCP_RESOURCE_URL = "https://system.thearcades.me/mcp";
  process.env.MCP_LEGACY_RESOURCE_URLS = "https://system-arcades-me.vercel.app/mcp";
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://system.thearcades.me";
  try {
    const challenge = mcpWwwAuthenticate();
    assert.match(challenge, /resource_metadata="https:\/\/system\.thearcades\.me\/\.well-known\/oauth-protected-resource"/);
    assert.doesNotMatch(challenge, /system-arcades-me\.vercel\.app/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("malformed bearer credentials are rejected before OAuth configuration is loaded", async () => {
  const originalDomain = process.env.AUTH0_DOMAIN;
  const originalResourceUrl = process.env.MCP_RESOURCE_URL;
  const originalPublicOrigin = process.env.SYSTEM_PUBLIC_ORIGIN;
  delete process.env.AUTH0_DOMAIN;
  delete process.env.MCP_RESOURCE_URL;
  delete process.env.SYSTEM_PUBLIC_ORIGIN;
  try {
    await assert.rejects(
      () => requireCompanionAccessToken(new Request("https://system.example/mcp", {
        headers: { authorization: "Bearer invalid" },
      })),
      (error: unknown) => error instanceof SystemError && error.code === "UNAUTHORIZED",
    );
    await assert.rejects(
      () => requireCompanionAccessToken(new Request("https://system.example/mcp", {
        headers: { authorization: "Bearer a.b.c" },
      })),
      /MCP OAuth is not configured/,
    );
  } finally {
    if (originalDomain === undefined) delete process.env.AUTH0_DOMAIN;
    else process.env.AUTH0_DOMAIN = originalDomain;
    if (originalResourceUrl === undefined) delete process.env.MCP_RESOURCE_URL;
    else process.env.MCP_RESOURCE_URL = originalResourceUrl;
    if (originalPublicOrigin === undefined) delete process.env.SYSTEM_PUBLIC_ORIGIN;
    else process.env.SYSTEM_PUBLIC_ORIGIN = originalPublicOrigin;
  }
});

test("inline image capabilities are owner- and image-scoped", () => {
  const original = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "test-signing-secret-with-enough-entropy";
  try {
    const capability = issueImageReadCapability("auth0:test-owner", "06117cba-18fa-4ae1-a39e-e1bb119a76c6");
    const claims = requireImageReadCapability(new Request(`https://system.example/api/system/images/inline/06117cba-18fa-4ae1-a39e-e1bb119a76c6?cap=${capability}`));
    assert.deepEqual({ sub: claims.sub, imageId: claims.imageId, scope: claims.scope }, { sub: "auth0:test-owner", imageId: "06117cba-18fa-4ae1-a39e-e1bb119a76c6", scope: "image:read" });
  } finally {
    if (original === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = original;
  }
});

test("scene image capabilities are owner- and render-scoped and never interchangeable with image capabilities", () => {
  const original = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "test-signing-secret-with-enough-entropy";
  try {
    const renderId = "3f1b7c0e-5d2a-4c9b-8e61-2a7d4f0c9b13";
    const capability = issueSceneImageReadCapability("auth0:test-owner", renderId);
    const claims = requireSceneImageReadCapability(new Request(`https://system.example/api/system/native-scenes/inline/${renderId}?cap=${capability}`));
    assert.deepEqual({ sub: claims.sub, renderId: claims.renderId, scope: claims.scope }, { sub: "auth0:test-owner", renderId, scope: "scene:read" });
    assert.throws(() => requireImageReadCapability(new Request(`https://system.example/api/system/images/inline/${renderId}?cap=${capability}`)), /image view capability/);
    const imageCapability = issueImageReadCapability("auth0:test-owner", renderId);
    assert.throws(() => requireSceneImageReadCapability(new Request(`https://system.example/api/system/native-scenes/inline/${renderId}?cap=${imageCapability}`)), /scene view capability/);
    assert.throws(() => requireSceneImageReadCapability(new Request(`https://system.example/api/system/native-scenes/inline/${renderId}`)), /scene view capability/);
  } finally {
    if (original === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = original;
  }
});


test("expired access tokens fail and a fresh token retains the same owner", async () => {
  const expired = await fixtureToken({ expiresIn: "-1s" });
  await assert.rejects(verifyCompanionAccessToken(expired.token, config, expired.getKey), /exp/);
  const fresh = await fixtureToken();
  assert.equal(await verifyCompanionAccessToken(fresh.token, config, fresh.getKey), ownerIdFromAuth0Subject("google-oauth2|immutable-google-subject"));
});
