import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp-server";
import { COMPANION_SCOPE, mcpWwwAuthenticate, requireCompanionAccessToken } from "@/server/mcp-authorization";

export const runtime = "nodejs";

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
export async function DELETE(request: Request) { return handle(request); }

async function rpcMethod(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    const body = await request.clone().json() as { method?: unknown };
    return typeof body.method === "string" ? body.method : undefined;
  } catch {
    return undefined;
  }
}

async function handle(request: Request) {
  const method = await rpcMethod(request);
  try {
    const ownerId = await requireCompanionAccessToken(request);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(ownerId);
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    console.info("[mcp] handled request", { httpMethod: request.method, rpcMethod: method, status: response.status });
    return addOAuthSecuritySchemes(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    console.warn("[mcp] rejected request", { httpMethod: request.method, rpcMethod: method, reason: message });
    let challenge = `Bearer scope="${COMPANION_SCOPE}"`;
    try { challenge = mcpWwwAuthenticate("invalid_token"); } catch { /* configuration error remains unauthorized */ }
    return Response.json({ error: message }, { status: 401, headers: { "WWW-Authenticate": challenge } });
  }
}

export async function addOAuthSecuritySchemes(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;
  const payload = await response.json() as { result?: { tools?: Array<Record<string, unknown>> } };
  if (payload.result?.tools) {
    payload.result.tools = payload.result.tools.map((tool) => ({
      ...tool,
      securitySchemes: [{ type: "oauth2", scopes: [COMPANION_SCOPE] }],
    }));
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(payload, { status: response.status, statusText: response.statusText, headers });
}
