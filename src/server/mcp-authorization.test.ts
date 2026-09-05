import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ownerIdFromAuth0Subject } from "@/server/auth";
import { COMPANION_SCOPE, issueImageReadCapability, requireImageReadCapability, verifyCompanionAccessToken, type McpAuthorizationConfig } from "@/server/mcp-authorization";

const config: McpAuthorizationConfig = {
  issuer: "https://tenant.example.auth0.com/",
  audience: "https://system.example/mcp",
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

test("MCP JWT verification rejects a token without the companion scope", async () => {
  const { token, getKey } = await fixtureToken({ scope: "openid email" });
  await assert.rejects(() => verifyCompanionAccessToken(token, config, getKey), /companion scope/i);
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


test("expired access tokens fail and a fresh token retains the same owner", async () => {
  const expired = await fixtureToken({ expiresIn: "-1s" });
  await assert.rejects(verifyCompanionAccessToken(expired.token, config, expired.getKey), /exp/);
  const fresh = await fixtureToken();
  assert.equal(await verifyCompanionAccessToken(fresh.token, config, fresh.getKey), ownerIdFromAuth0Subject("google-oauth2|immutable-google-subject"));
});
