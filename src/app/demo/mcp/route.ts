import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { fictionalDemoEnabled } from "@/server/fictional-demo";
import { createFictionalDemoServer } from "@/server/fictional-demo-mcp";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!fictionalDemoEnabled()) return new Response(null, { status: 404 });
  const url = new URL(request.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response(null, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return new Response(null, { status: 403 });
  const server = createFictionalDemoServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
