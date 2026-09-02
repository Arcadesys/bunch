import assert from "node:assert/strict";
import test from "node:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { ownerIdFromAuth0Subject } from "@/server/auth";
import { COMPANION_SCOPE, verifyCompanionAccessToken, type McpAuthorizationConfig } from "@/server/mcp-authorization";

const config: McpAuthorizationConfig = {
  issuer: "https://tenant.example.auth0.com/",
  audience: "https://system.example/mcp",
  jwksUri: new URL("https://tenant.example.auth0.com/.well-known/jwks.json"),
};

async function fixtureToken(overrides: { audience?: string; scope?: string } = {}) {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  const token = await new SignJWT({ scope: overrides.scope ?? COMPANION_SCOPE })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("google-oauth2|immutable-google-subject")
    .setIssuer(config.issuer)
    .setAudience(overrides.audience ?? config.audience)
    .setIssuedAt()
    .setExpirationTime("5m")
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
