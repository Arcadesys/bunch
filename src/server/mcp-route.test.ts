import assert from "node:assert/strict";
import test from "node:test";
import { addOAuthSecuritySchemes } from "@/server/mcp-http";
import { COMPANION_SCOPE } from "@/server/mcp-authorization";

test("hosted MCP tool descriptors declare the OAuth scope", async () => {
  const input = Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { tools: [{ name: "list_alters", inputSchema: { type: "object" } }] },
  });
  const response = await addOAuthSecuritySchemes(input);
  const payload = await response.json();
  assert.deepEqual(payload.result.tools[0].securitySchemes, [
    { type: "oauth2", scopes: [COMPANION_SCOPE] },
  ]);
});
