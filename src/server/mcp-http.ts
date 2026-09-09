import { createDemoMcpServer, DEMO_TOOL_NAMES } from "./demo-mcp-server";
import { SystemError } from "@/server/system-error";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp-server";
import { COMPANION_SCOPE, mcpWwwAuthenticate, requireCompanionAccessToken } from "@/server/mcp-authorization";

async function rpcMethod(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    const body = await request.clone().json() as { method?: unknown };
    return typeof body.method === "string" && ["initialize","notifications/initialized","tools/list","tools/call","resources/list","resources/read","ping"].includes(body.method) ? body.method : "other";
  } catch {
    return undefined;
  }
}

type Dependencies = {
  authorize: typeof requireCompanionAccessToken;
  privateServer: typeof createMcpServer;
};

// Only a truly absent Authorization header selects public fiction. Invalid,
// empty, expired, or revoked credentials must never silently become a demo.
async function permitsAnonymousDemo(request: Request) {
  if (request.headers.has("authorization")) return false;
  // Streamable HTTP clients probe GET for an SSE stream after initialize.
  // This stateless server returns 405, not an OAuth prompt for demo visitors.
  if (request.method === "GET") return true;
  if (request.method !== "POST") return false;
  try {
    const body = await request.clone().json();
    if (!body || Array.isArray(body) || body.jsonrpc !== "2.0") return false;
    if (["initialize", "notifications/initialized", "tools/list", "ping"].includes(body.method)) return true;
    return body.method === "tools/call" && DEMO_TOOL_NAMES.has(body.params?.name);
  } catch { return false; }
}

export async function handleMcpRequest(request: Request, dependencies: Dependencies = { authorize: requireCompanionAccessToken, privateServer: createMcpServer }) {
  const method = await rpcMethod(request);
  try {
    const anonymousDemo = await permitsAnonymousDemo(request);
    if (anonymousDemo && request.method === "GET") return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
    const ownerId = anonymousDemo ? null : await dependencies.authorize(request);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = ownerId === null ? createDemoMcpServer() : dependencies.privateServer(ownerId);
    await server.connect(transport);
    let response: Response;
    try { response = await transport.handleRequest(request); } finally { await server.close(); }
    console.info("[mcp] handled request", { httpMethod: request.method, rpcMethod: method, status: response.status });
    return addOAuthSecuritySchemes(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    console.warn("[mcp] rejected request", { httpMethod: request.method, rpcMethod: method, reason: error instanceof SystemError ? error.code : "REQUEST_REJECTED" });
    let challenge = `Bearer scope="${COMPANION_SCOPE}"`;
    try { challenge = mcpWwwAuthenticate("invalid_token"); } catch { /* configuration error remains unauthorized */ }
    return Response.json({ error: message }, { status: error instanceof SystemError && error.code === "RATE_LIMITED" ? 429 : error instanceof SystemError && error.code === "FORBIDDEN" ? 403 : 401, headers: { "WWW-Authenticate": challenge } });
  }
}

export async function addOAuthSecuritySchemes(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  response.headers.set("Cache-Control", "no-store");
  if (!contentType.includes("application/json")) return response;
  const payload = await response.json() as { result?: { tools?: Array<Record<string, unknown>> } };
  if (payload.result?.tools) {
    payload.result.tools = payload.result.tools.map((tool) => ({
      ...tool,
      securitySchemes: typeof tool.name === "string" && DEMO_TOOL_NAMES.has(tool.name) ? [{ type: "noauth" }] : [{ type: "oauth2", scopes: [COMPANION_SCOPE] }],
    }));
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json(payload, { status: response.status, statusText: response.statusText, headers });
}
