import { getPilotService } from "./pilot-service";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";
import { ownerIdFromAuth0Subject } from "@/server/auth";

type ImageUploadClaims = { sub: string; alterId: string; scope: "image:write"; exp: number; requestId?: string; generatedResult?: true };
type ImageReadClaims = { sub: string; imageId: string; scope: "image:read"; exp: number };
export const COMPANION_SCOPE = "system:companion";
export const COMPANION_OAUTH_SCOPES = [COMPANION_SCOPE, "openid", "profile", "email", "offline_access"] as const;

export type McpAuthorizationConfig = {
  issuer: string;
  audience: string;
  jwksUri: URL;
};

function normalizedIssuer(domain: string) {
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
}

export function getMcpAuthorizationConfig(): McpAuthorizationConfig {
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.MCP_RESOURCE_URL ?? `${process.env.SYSTEM_PUBLIC_ORIGIN?.replace(/\/$/, "")}/mcp`;
  if (!domain || !audience || audience.startsWith("undefined")) throw new Error("MCP OAuth is not configured.");
  const issuer = normalizedIssuer(domain);
  return { issuer, audience, jwksUri: new URL(".well-known/jwks.json", issuer) };
}

export function getMcpResourceMetadataUrl() {
  const origin = process.env.SYSTEM_PUBLIC_ORIGIN?.replace(/\/$/, "");
  if (!origin) throw new Error("SYSTEM_PUBLIC_ORIGIN is not configured.");
  return `${origin}/.well-known/oauth-protected-resource`;
}

export function mcpWwwAuthenticate(error?: "invalid_token" | "insufficient_scope") {
  const fields = [
    `resource_metadata="${getMcpResourceMetadataUrl()}"`,
    `scope="${COMPANION_SCOPE}"`,
  ];
  if (error) fields.push(`error="${error}"`);
  return `Bearer ${fields.join(", ")}`;
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signClaims(claims: object) {
  const secret = process.env.MCP_TOKEN_SIGNING_SECRET;
  if (!secret) throw new Error("MCP token signing is not configured.");
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${encodedClaims}.${createHmac("sha256", secret).update(encodedClaims).digest("base64url")}`;
}

function verifiedClaims<T extends { exp: number }>(token: string): T {
  const secret = process.env.MCP_TOKEN_SIGNING_SECRET;
  const [encodedClaims, signature] = token.split(".");
  if (!secret || !encodedClaims || !signature) throw new Error("A valid authorization is required.");
  const expected = createHmac("sha256", secret).update(encodedClaims).digest("base64url");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new Error("A valid authorization is required.");
  let claims: T;
  try { claims = JSON.parse(decode(encodedClaims)); } catch { throw new Error("A valid authorization is required."); }
  if (claims.exp * 1000 <= Date.now()) throw new Error("Authorization has expired.");
  return claims;
}

function grantedScopes(payload: JWTPayload) {
  const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.filter((value): value is string => typeof value === "string")
    : [];
  return new Set([...scopes, ...permissions]);
}

export async function verifyCompanionAccessToken(
  token: string,
  config = getMcpAuthorizationConfig(),
  getKey: JWTVerifyGetKey = createRemoteJWKSet(config.jwksUri),
) {
  const { payload } = await jwtVerify(token, getKey, {
    algorithms: ["RS256"],
    issuer: config.issuer,
    audience: config.audience,
  });
  if (!payload.sub || !grantedScopes(payload).has(COMPANION_SCOPE)) {
    throw new Error("The System companion scope is required.");
  }
  return ownerIdFromAuth0Subject(payload.sub);
}

// Auth0 issues the revocable OAuth access token after Google-backed consent.
// Website sessions and MCP requests derive ownership from the same immutable sub.
export async function requireCompanionAccessToken(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("A valid System authorization is required.");
  const ownerId = await verifyCompanionAccessToken(authorization.slice(7));
  await getPilotService().assertAccess(ownerId, "mcp");
  return ownerId;
}

export function issueImageUploadCapability(ownerId: string, alterId: string) {
  return signClaims({ sub: ownerId, alterId, scope: "image:write", exp: Math.floor(Date.now() / 1000) + 60 });
}

// A generated keeper is a distinct write from an ordinary gallery upload. Bind
// its short-lived bearer capability to the receipt request ID so the endpoint
// cannot accidentally treat a retry as a new gallery item.
export function issueFurryResultUploadCapability(ownerId: string, alterId: string, requestId: string) {
  return signClaims({ sub: ownerId, alterId, requestId, generatedResult: true, scope: "image:write", exp: Math.floor(Date.now() / 1000) + 60 });
}

export function requireImageUploadCapability(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("A valid image upload capability is required.");
  const claims = verifiedClaims<ImageUploadClaims>(authorization.slice(7));
  if (!claims.sub || !claims.alterId || claims.scope !== "image:write") throw new Error("A valid image upload capability is required.");
  return claims;
}

export function requireFurryResultUploadCapability(request: Request) {
  const claims = requireImageUploadCapability(request);
  if (!claims.generatedResult || !claims.requestId) throw new Error("A valid generated-result capability is required.");
  return claims as ImageUploadClaims & { requestId: string; generatedResult: true };
}

// Widget-only image URLs need a capability because the ChatGPT iframe does not
// share the owner's Auth0 website session. The capability is scoped to one
// image and expires quickly; storage keys never leave the backend.
export function issueImageReadCapability(ownerId: string, imageId: string) {
  return signClaims({ sub: ownerId, imageId, scope: "image:read", exp: Math.floor(Date.now() / 1000) + 5 * 60 });
}

export function requireImageReadCapability(request: Request) {
  const token = new URL(request.url).searchParams.get("cap");
  if (!token) throw new Error("A valid image view capability is required.");
  const claims = verifiedClaims<ImageReadClaims>(token);
  if (!claims.sub || !claims.imageId || claims.scope !== "image:read") throw new Error("A valid image view capability is required.");
  return claims;
}
