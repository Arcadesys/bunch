import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as GET_PATH_AWARE } from "@/app/.well-known/oauth-protected-resource/mcp/route";
import { GET as GET_PATH_COMPAT } from "@/app/mcp/.well-known/oauth-protected-resource/route";

test("protected resource discovery includes offline access for renewable MCP authorization", async () => {
  const original = {
    AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
    MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL,
    MCP_LEGACY_RESOURCE_URLS: process.env.MCP_LEGACY_RESOURCE_URLS,
    SYSTEM_PUBLIC_ORIGIN: process.env.SYSTEM_PUBLIC_ORIGIN,
  };
  process.env.AUTH0_DOMAIN = "tenant.example.auth0.com";
  process.env.MCP_RESOURCE_URL = "https://system.example/mcp";
  process.env.MCP_LEGACY_RESOURCE_URLS = "https://legacy-system.example/mcp";
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://system.example";

  try {
    const response = GET();
    const body = await response.json() as { resource: string; scopes_supported: string[] };
    assert.equal(body.resource, "https://system.example/mcp");
    assert.deepEqual(body.scopes_supported, ["system:companion", "openid", "profile", "email", "offline_access"]);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("path-aware protected resource aliases return the same metadata", async () => {
  const original = {
    AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
    MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL,
    SYSTEM_PUBLIC_ORIGIN: process.env.SYSTEM_PUBLIC_ORIGIN,
  };
  process.env.AUTH0_DOMAIN = "tenant.example.auth0.com";
  process.env.MCP_RESOURCE_URL = "https://system.example/mcp";
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://system.example";

  try {
    const canonical = await GET().json();
    const pathAware = await GET_PATH_AWARE().json();
    const pathCompat = await GET_PATH_COMPAT().json();
    assert.deepEqual(pathAware, canonical);
    assert.deepEqual(pathCompat, canonical);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("path-aware protected resource aliases return the same metadata", async () => {
  const original = {
    AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
    MCP_RESOURCE_URL: process.env.MCP_RESOURCE_URL,
    SYSTEM_PUBLIC_ORIGIN: process.env.SYSTEM_PUBLIC_ORIGIN,
  };
  process.env.AUTH0_DOMAIN = "tenant.example.auth0.com";
  process.env.MCP_RESOURCE_URL = "https://system.example/mcp";
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://system.example";

  try {
    const canonical = await GET().json();
    const pathAware = await GET_PATH_AWARE().json();
    const pathCompat = await GET_PATH_COMPAT().json();
    assert.deepEqual(pathAware, canonical);
    assert.deepEqual(pathCompat, canonical);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
