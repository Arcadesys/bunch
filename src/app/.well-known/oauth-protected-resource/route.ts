import { COMPANION_OAUTH_SCOPES, getMcpAuthorizationConfig } from "@/server/mcp-authorization";

export const runtime = "nodejs";

export function GET() {
  try {
    const { issuer, audience } = getMcpAuthorizationConfig();
    return Response.json({
      resource: audience,
      authorization_servers: [issuer],
      scopes_supported: COMPANION_OAUTH_SCOPES,
      resource_documentation: `${process.env.SYSTEM_PUBLIC_ORIGIN?.replace(/\/$/, "")}/`,
    }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP OAuth is not configured.";
    return Response.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
