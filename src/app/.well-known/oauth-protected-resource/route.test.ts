import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "@/app/.well-known/oauth-protected-resource/route";

test("protected resource discovery includes offline access for renewable MCP authorization", async () => {
  const original = {
    AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
    MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL,
    SYSTEM_PUBLIC_ORIGIN: process.env.SYSTEM_PUBLIC_ORIGIN,
  };
  process.env.AUTH0_DOMAIN = "tenant.example.auth0.com";
  process.env.MCP_RESOURCE_URL = "https://system.example/mcp";
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://system.example";

  try {
    const response = GET();
    const body = await response.json() as { scopes_supported: string[] };
    assert.deepEqual(body.scopes_supported, ["system:companion", "openid", "profile", "email", "offline_access"]);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
