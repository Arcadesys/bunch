import { CONNECT_PRIVATE_SYSTEM_TOOL_NAME, createDemoMcpServer, DEMO_TOOL_NAMES } from "./demo-mcp-server";
import { SystemError } from "@/server/system-error";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/server/mcp-server";
import { COMPANION_SCOPE, mcpWwwAuthenticate, requireCompanionAccessToken } from "@/server/mcp-authorization";

const PUBLIC_RPC_METHODS = new Set([
  "server/discover",
  "initialize",
  "notifications/initialized",
  "tools/list",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
  "ping",
]);
const LOGGABLE_RPC_METHOD = /^[a-z][a-z0-9._/-]{0,80}$/;
const ANONYMOUS_TOOL_NAMES = new Set([...DEMO_TOOL_NAMES, CONNECT_PRIVATE_SYSTEM_TOOL_NAME]);

type McpServer = ReturnType<typeof createMcpServer>;
type McpTransport = WebStandardStreamableHTTPServerTransport;

export type McpHttpOptions = {
  authorize?: typeof requireCompanionAccessToken;
  createDemoServer?: () => Pick<McpServer, "connect" | "close">;
  createPrivateServer?: (ownerId: string, scheduleNativeScene?: (ownerId: string, renderId: string) => void) => Pick<McpServer, "connect" | "close">;
  createTransport?: () => McpTransport;
  scheduleNativeScene?: (ownerId: string, renderId: string) => void;
};

type RequestClassification = {
  anonymousDemo: boolean;
  rpcMethod: string | undefined;
};

async function classifyRequest(request: Request): Promise<RequestClassification> {
  let body: Record<string, unknown> | undefined;
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const parsed = await request.clone().json();
      if (parsed && !Array.isArray(parsed) && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch { /* malformed bodies remain protected */ }
  }

  const suppliedMethod = typeof body?.method === "string" ? body.method : undefined;
  const rpcMethod = suppliedMethod
    ? (LOGGABLE_RPC_METHOD.test(suppliedMethod) ? suppliedMethod : "other")
    : undefined;
  if (request.headers.has("authorization")) return { anonymousDemo: false, rpcMethod };

  // Streamable HTTP clients probe GET for an SSE stream after initialize. This
  // service is stateless, so the public probe is answered without prompting for
  // OAuth. DELETE and malformed/unknown requests stay behind authorization.
  if (request.method === "GET") return { anonymousDemo: true, rpcMethod };
  if (request.method !== "POST" || body?.jsonrpc !== "2.0") return { anonymousDemo: false, rpcMethod };
  if (suppliedMethod && PUBLIC_RPC_METHODS.has(suppliedMethod)) return { anonymousDemo: true, rpcMethod };
  const toolName = body.params && typeof body.params === "object" && !Array.isArray(body.params)
    ? (body.params as { name?: unknown }).name
    : undefined;
  return { anonymousDemo: suppliedMethod === "tools/call" && typeof toolName === "string" && ANONYMOUS_TOOL_NAMES.has(toolName), rpcMethod };
}

function defaultTransport() {
  return new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
}

function defaultPrivateServer(ownerId: string, scheduleNativeScene?: (ownerId: string, renderId: string) => void) {
  return createMcpServer(ownerId, undefined, undefined, undefined, undefined, scheduleNativeScene);
}

function safeChallenge() {
  try { return mcpWwwAuthenticate("invalid_token"); }
  catch { return `Bearer scope="${COMPANION_SCOPE}", error="invalid_token"`; }
}

function failureResponse(error: unknown, phase: "authorization" | "request") {
  let status = 500;
  let message = "Bunch could not process this MCP request.";
  let challenge = false;

  if (phase === "authorization") {
    if (error instanceof SystemError && error.code === "UNAUTHORIZED") {
      status = 401;
      message = "Authentication required.";
      challenge = true;
    } else if (error instanceof SystemError && error.code === "FORBIDDEN") {
      status = 403;
      message = error.userMessage;
    } else if (error instanceof SystemError && error.code === "RATE_LIMITED") {
      status = 429;
      message = error.userMessage;
    }
  }

  const headers = new Headers({ "Cache-Control": "no-store" });
  if (challenge) headers.set("WWW-Authenticate", safeChallenge());
  return Response.json({ error: message }, { status, headers });
}

export async function handleMcpRequest(request: Request, options: McpHttpOptions = {}) {
  const classification = await classifyRequest(request);
  if (classification.anonymousDemo && request.method === "GET") {
    return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
  }

  const authorize = options.authorize ?? requireCompanionAccessToken;
  let ownerId: string | null = null;
  if (!classification.anonymousDemo) {
    try {
      ownerId = await authorize(request);
    } catch (error) {
      console.warn("[mcp] rejected authorization", {
        httpMethod: request.method,
        rpcMethod: classification.rpcMethod,
        reason: error instanceof SystemError ? error.code : "AUTHORIZATION_FAILED",
      });
      return failureResponse(error, "authorization");
    }
  }

  const createTransport = options.createTransport ?? defaultTransport;
  const createDemoServer = options.createDemoServer ?? createDemoMcpServer;
  const createPrivateServer = options.createPrivateServer ?? defaultPrivateServer;
  let server: Pick<McpServer, "connect" | "close"> | undefined;
  let response: Response | undefined;
  let requestFailure: unknown;

  try {
    const transport = createTransport();
    server = ownerId === null
      ? createDemoServer()
      : createPrivateServer(ownerId, options.scheduleNativeScene);
    await server.connect(transport);
    response = await transport.handleRequest(request);
    response = await addOAuthSecuritySchemes(response);
    console.info("[mcp] handled request", { httpMethod: request.method, rpcMethod: classification.rpcMethod, status: response.status });
  } catch (error) {
    requestFailure = error;
    console.warn("[mcp] request failed", { httpMethod: request.method, rpcMethod: classification.rpcMethod, reason: "REQUEST_FAILED" });
  } finally {
    if (server) {
      try { await server.close(); }
      catch {
        console.warn("[mcp] cleanup failed", { httpMethod: request.method, rpcMethod: classification.rpcMethod, reason: "CLEANUP_FAILED" });
      }
    }
  }

  return requestFailure || !response ? failureResponse(requestFailure, "request") : response;
}

function hasToolList(payload: unknown): payload is { result: { tools: unknown[] } } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const result = (payload as { result?: unknown }).result;
  return Boolean(result && typeof result === "object" && !Array.isArray(result) && Array.isArray((result as { tools?: unknown }).tools));
}

export async function addOAuthSecuritySchemes(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  const unchanged = () => new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  if (!headers.get("content-type")?.includes("application/json")) return unchanged();

  let payload: unknown;
  try { payload = await response.clone().json(); }
  catch { return unchanged(); }
  if (!hasToolList(payload)) return unchanged();

  payload.result.tools = payload.result.tools.map((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return tool;
    const descriptor = tool as Record<string, unknown>;
    const securitySchemes = typeof descriptor.name === "string" && DEMO_TOOL_NAMES.has(descriptor.name)
      ? [{ type: "noauth" }]
      : [{ type: "oauth2", scopes: [COMPANION_SCOPE] }];
    const meta = descriptor._meta && typeof descriptor._meta === "object" && !Array.isArray(descriptor._meta)
      ? descriptor._meta as Record<string, unknown>
      : {};
    return {
      ...descriptor,
      securitySchemes,
      _meta: { ...meta, securitySchemes },
    };
  });
  headers.delete("content-length");
  return new Response(JSON.stringify(payload), { status: response.status, statusText: response.statusText, headers });
}
