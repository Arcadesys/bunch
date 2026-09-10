import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { generateKeyPair, SignJWT } from "jose";
import { SystemService } from "./system-service";
import { createMcpServer } from "./mcp-server";
import { handleMcpRequest } from "./mcp-http";
import { COMPANION_SCOPE, verifyCompanionAccessToken } from "./mcp-authorization";

// The MCP server has no default origin, so every test that builds one must say
// where this instance is served from. Pinned rather than defaulted: these
// assertions must not change with whatever origin the shell happens to export.
process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch.example";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("signed MCP tokens still read only their own database records alongside the public demo", async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const service = new SystemService(pool);
  const subjects = [`demo-isolation:${randomUUID()}`, `demo-isolation:${randomUUID()}`];
  const owners = subjects.map(s => `auth0:${s}`);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const config = { issuer: "https://auth.example/", audience: "https://bunch.example/mcp", jwksUri: new URL("https://auth.example/jwks") };
  const request = (name: string, args: object, token?: string) => new Request(config.audience, {
    method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const dependencies = {
    authorize: async (req: Request) => verifyCompanionAccessToken(req.headers.get("authorization")!.slice(7), config, async () => publicKey),
    privateServer: (ownerId: string) => createMcpServer(ownerId, service),
  };
  try {
    const profiles = await Promise.all(owners.map((owner, i) => service.createAlter(owner, { requestId: randomUUID(), name: `Private test person ${i + 1}` }, "WEB")));
    for (let i = 0; i < owners.length; i++) {
      const token = await new SignJWT({ scope: COMPANION_SCOPE }).setProtectedHeader({ alg: "RS256" }).setSubject(subjects[i]).setIssuer(config.issuer).setAudience(config.audience).setExpirationTime("5m").sign(privateKey);
      const response = await handleMcpRequest(request("list_alters", {}, token), dependencies);
      assert.equal(response.status, 200);
      const result = (await response.json()).result;
      assert.deepEqual(result.structuredContent.data.map((p: { id: string }) => p.id), [profiles[i].data.id]);
      assert.doesNotMatch(JSON.stringify(result), /Fenton|Benny|Dot/);
      const foreign = await handleMcpRequest(request("get_alter", { alterId: profiles[1 - i].data.id }, token), dependencies);
      assert.equal((await foreign.json()).result.isError, true);
    }
    const demo = await handleMcpRequest(request("get_demo_system", {}), dependencies);
    assert.equal(demo.status, 200);
    assert.doesNotMatch(await demo.text(), /Private test person|demo-isolation/);
    for (const owner of owners) assert.equal((await service.listAlters(owner, {})).data.length, 1, "demo reads never seed or mutate tenants");
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [owners]);
    await pool.end();
  }
});
