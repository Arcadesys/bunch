import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { addOAuthSecuritySchemes, handleMcpRequest, type McpHttpOptions } from "@/server/mcp-http";
import { COMPANION_SCOPE } from "@/server/mcp-authorization";
import { SystemError } from "@/server/system-error";

function rpc(method: string, params?: unknown, headers: Record<string, string> = {}) {
  return new Request("https://bunch.example/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

function transportReturning(response: Response | Error) {
  return {
    handleRequest: async () => {
      if (response instanceof Error) throw response;
      return response;
    },
  } as unknown as WebStandardStreamableHTTPServerTransport;
}

function serverLifecycle(options: { connectError?: Error; closeError?: Error } = {}) {
  const calls = { connect: 0, close: 0 };
  const server = {
    connect: async () => {
      calls.connect += 1;
      if (options.connectError) throw options.connectError;
    },
    close: async () => {
      calls.close += 1;
      if (options.closeError) throw options.closeError;
    },
  } as unknown as Pick<McpServer, "connect" | "close">;
  return { calls, server };
}

test("hosted MCP tool descriptors declare demo and private security without losing response metadata", async () => {
  const input = Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { tools: [{ name: "get_demo_system" }, { name: "list_alters", _meta: { "openai/profile": true } }, null] },
  }, { status: 207, statusText: "Multi-Status", headers: { "X-Adapter-Test": "preserved" } });
  const response = await addOAuthSecuritySchemes(input);
  const payload = await response.json();
  assert.equal(response.status, 207);
  assert.equal(response.statusText, "Multi-Status");
  assert.equal(response.headers.get("x-adapter-test"), "preserved");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(payload.result.tools, [
    { name: "get_demo_system", securitySchemes: [{ type: "noauth" }], _meta: { securitySchemes: [{ type: "noauth" }] } },
    { name: "list_alters", securitySchemes: [{ type: "oauth2", scopes: [COMPANION_SCOPE] }], _meta: { "openai/profile": true, securitySchemes: [{ type: "oauth2", scopes: [COMPANION_SCOPE] }] } },
    null,
  ]);
});

test("response decoration tolerates non-tool JSON, scalar JSON, and non-JSON bodies", async () => {
  const cases = [
    Response.json({ ok: true }, { status: 202, headers: { "X-Adapter-Test": "object" } }),
    new Response("7", { status: 206, headers: { "Content-Type": "application/json", "X-Adapter-Test": "scalar" } }),
    new Response("plain", { status: 203, headers: { "Content-Type": "text/plain", "X-Adapter-Test": "plain" } }),
  ];
  for (const input of cases) {
    const expectedStatus = input.status;
    const expectedMarker = input.headers.get("x-adapter-test");
    const expectedBody = await input.clone().text();
    const response = await addOAuthSecuritySchemes(input);
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("x-adapter-test"), expectedMarker);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), expectedBody);
  }
});

test("anonymous routing selects only the demo server and a fresh transport", async () => {
  let authorizeCalls = 0;
  let demoServers = 0;
  let privateServers = 0;
  let transports = 0;
  const lifecycle = serverLifecycle();
  const response = await handleMcpRequest(rpc("ping"), {
    authorize: async () => { authorizeCalls += 1; throw new Error("must not authorize"); },
    createDemoServer: () => { demoServers += 1; return lifecycle.server; },
    createPrivateServer: () => { privateServers += 1; throw new Error("must not create private server"); },
    createTransport: () => { transports += 1; return transportReturning(Response.json({ jsonrpc: "2.0", id: 1, result: {} })); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual({ authorizeCalls, demoServers, privateServers, transports, ...lifecycle.calls }, {
    authorizeCalls: 0, demoServers: 1, privateServers: 0, transports: 1, connect: 1, close: 1,
  });
});

test("anonymous tool discovery merges demo and private descriptors without authorizing access", async () => {
  let authorizeCalls = 0;
  let transportCalls = 0;
  let receivedOwner: string | undefined;
  const demoLifecycle = serverLifecycle();
  const privateLifecycle = serverLifecycle();
  const response = await handleMcpRequest(rpc("tools/list"), {
    authorize: async () => { authorizeCalls += 1; throw new Error("must not authorize discovery"); },
    createDemoServer: () => demoLifecycle.server,
    createPrivateServer: (ownerId) => {
      receivedOwner = ownerId;
      return privateLifecycle.server;
    },
    createTransport: () => {
      const response = transportCalls === 0
        ? Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "get_demo_system" }, { name: "get_account_profile" }] } })
        : Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "get_account_profile" }, { name: "list_alters" }] } });
      transportCalls += 1;
      return transportReturning(response);
    },
  });
  assert.equal(response.status, 200);
  assert.equal(authorizeCalls, 0);
  assert.equal(receivedOwner, "discovery:anonymous");
  assert.equal(transportCalls, 2);
  assert.deepEqual(demoLifecycle.calls, { connect: 1, close: 1 });
  assert.deepEqual(privateLifecycle.calls, { connect: 1, close: 1 });
  assert.deepEqual((await response.json()).result.tools, [
    { name: "get_demo_system", securitySchemes: [{ type: "noauth" }], _meta: { securitySchemes: [{ type: "noauth" }] } },
    { name: "get_account_profile", securitySchemes: [{ type: "oauth2", scopes: [COMPANION_SCOPE] }], _meta: { securitySchemes: [{ type: "oauth2", scopes: [COMPANION_SCOPE] }] } },
    { name: "list_alters", securitySchemes: [{ type: "oauth2", scopes: [COMPANION_SCOPE] }], _meta: { securitySchemes: [{ type: "oauth2", scopes: [COMPANION_SCOPE] }] } },
  ]);
});

test("protected and malformed request shapes never fall back to the Demo system", async () => {
  const requests = [
    rpc("tools/call", { name: "list_alters", arguments: {} }),
    rpc("tools/call", { name: "get_account_profile", arguments: {} }),
    rpc("resources/read", { uri: "private" }),
    rpc("unknown/method"),
    new Request("https://bunch.example/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
    new Request("https://bunch.example/mcp", { method: "DELETE" }),
  ];
  for (const request of requests) {
    const response = await handleMcpRequest(request, {
      authorize: async () => { throw new SystemError("UNAUTHORIZED", "internal authorization detail"); },
      createDemoServer: () => { throw new Error("Demo server must not be created"); },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
    assert.deepEqual(await response.json(), { error: "Authentication required." });
  }

  let probeAuthorizeCalls = 0;
  const probeLifecycle = serverLifecycle();
  const streamProbe = await handleMcpRequest(new Request("https://bunch.example/mcp", { headers: { accept: "text/event-stream" } }), {
    authorize: async () => { probeAuthorizeCalls += 1; throw new Error("must not authorize public stream probe"); },
    createDemoServer: () => probeLifecycle.server,
    createPrivateServer: () => { throw new Error("must not create private server for public stream probe"); },
    createTransport: () => transportReturning(new Response(": ready\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "X-Adapter-Test": "stream-probe" },
    })),
  });
  assert.equal(streamProbe.status, 200);
  assert.equal(streamProbe.headers.get("content-type"), "text/event-stream");
  assert.equal(streamProbe.headers.get("x-adapter-test"), "stream-probe");
  assert.equal(streamProbe.headers.get("cache-control"), "no-store");
  assert.equal(streamProbe.headers.has("www-authenticate"), false);
  assert.equal(probeAuthorizeCalls, 0);
  assert.deepEqual(probeLifecycle.calls, { connect: 1, close: 1 });
});

test("the production transport accepts an anonymous SSE connection probe", async () => {
  const response = await handleMcpRequest(new Request("https://bunch.example/mcp", {
    headers: { accept: "text/event-stream" },
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("www-authenticate"), false);
  await response.body?.cancel();
});

test("authorization failures have distinct safe status and challenge contracts", async () => {
  const originalPublicOrigin = process.env.SYSTEM_PUBLIC_ORIGIN;
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch.example";
  const cases: Array<{ error: Error; status: number; message: string; challenge: boolean }> = [
    { error: new SystemError("UNAUTHORIZED", "token verifier detail"), status: 401, message: "Authentication required.", challenge: true },
    { error: new SystemError("FORBIDDEN", "This Bunch account is not enabled."), status: 403, message: "This Bunch account is not enabled.", challenge: false },
    { error: new SystemError("RATE_LIMITED", "Try again later."), status: 429, message: "Try again later.", challenge: false },
    { error: new Error("database password leaked"), status: 500, message: "Bunch could not process this MCP request.", challenge: false },
  ];
  try {
    for (const expected of cases) {
      const response = await handleMcpRequest(rpc("tools/call", { name: "list_alters", arguments: {} }), {
        authorize: async () => { throw expected.error; },
      });
      assert.equal(response.status, expected.status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("www-authenticate"), expected.challenge
        ? 'Bearer resource_metadata="https://bunch.example/.well-known/oauth-protected-resource", scope="system:companion", error="invalid_token"'
        : null);
      assert.deepEqual(await response.json(), { error: expected.message });
    }
  } finally {
    if (originalPublicOrigin === undefined) delete process.env.SYSTEM_PUBLIC_ORIGIN;
    else process.env.SYSTEM_PUBLIC_ORIGIN = originalPublicOrigin;
  }
});

test("authenticated routing preserves the verified owner and native-scene scheduler", async () => {
  const scheduler = () => undefined;
  const lifecycle = serverLifecycle();
  let receivedOwner: string | undefined;
  let receivedScheduler: McpHttpOptions["scheduleNativeScene"];
  const response = await handleMcpRequest(rpc("tools/call", { name: "get_companion_state", arguments: {} }, { authorization: "Bearer valid" }), {
    authorize: async () => "auth0:verified-owner",
    createDemoServer: () => { throw new Error("must not create demo server"); },
    createPrivateServer: (ownerId, scheduleNativeScene) => {
      receivedOwner = ownerId;
      receivedScheduler = scheduleNativeScene;
      return lifecycle.server;
    },
    createTransport: () => transportReturning(Response.json({ jsonrpc: "2.0", id: 1, result: { content: [] } })),
    scheduleNativeScene: scheduler,
  });
  assert.equal(response.status, 200);
  assert.equal(receivedOwner, "auth0:verified-owner");
  assert.equal(receivedScheduler, scheduler);
  assert.deepEqual(lifecycle.calls, { connect: 1, close: 1 });
});

test("server, transport, and response-decoration failures return a safe 500 and close created servers once", async () => {
  const scenarios = ["transport factory", "server factory", "connect", "handle", "decorate"] as const;
  for (const scenario of scenarios) {
    const lifecycle = serverLifecycle({ connectError: scenario === "connect" ? new Error("connect secret") : undefined });
    const options: McpHttpOptions = {
      authorize: async () => "auth0:owner",
      createPrivateServer: () => {
        if (scenario === "server factory") throw new Error("server factory secret");
        return lifecycle.server;
      },
      createTransport: () => {
        if (scenario === "transport factory") throw new Error("transport factory secret");
        if (scenario === "decorate") return {
          handleRequest: async () => {
            const consumed = Response.json({ ok: true });
            await consumed.text();
            return consumed;
          },
        } as unknown as WebStandardStreamableHTTPServerTransport;
        return transportReturning(scenario === "handle" ? new Error("handle secret") : Response.json({ ok: true }));
      },
    };
    const response = await handleMcpRequest(rpc("tools/call", { name: "list_alters", arguments: {} }, { authorization: "Bearer valid" }), options);
    assert.equal(response.status, 500, scenario);
    assert.equal(response.headers.get("cache-control"), "no-store", scenario);
    assert.equal(response.headers.has("www-authenticate"), false, scenario);
    assert.deepEqual(await response.json(), { error: "Bunch could not process this MCP request." }, scenario);
    assert.equal(lifecycle.calls.close, scenario === "transport factory" || scenario === "server factory" ? 0 : 1, scenario);
  }
});

test("cleanup failures are sanitized and do not replace a completed response", async () => {
  const lifecycle = serverLifecycle({ closeError: new Error("cleanup secret") });
  const response = await handleMcpRequest(rpc("tools/call", { name: "list_alters", arguments: {} }, { authorization: "Bearer valid" }), {
    authorize: async () => "auth0:owner",
    createPrivateServer: () => lifecycle.server,
    createTransport: () => transportReturning(new Response("complete", { status: 202, headers: { "Content-Type": "text/plain" } })),
  });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), "complete");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(lifecycle.calls, { connect: 1, close: 1 });

  const failedLifecycle = serverLifecycle({ closeError: new Error("secondary cleanup secret") });
  const failedResponse = await handleMcpRequest(rpc("tools/call", { name: "list_alters", arguments: {} }, { authorization: "Bearer valid" }), {
    authorize: async () => "auth0:owner",
    createPrivateServer: () => failedLifecycle.server,
    createTransport: () => transportReturning(new Error("primary request secret")),
  });
  assert.equal(failedResponse.status, 500);
  assert.deepEqual(await failedResponse.json(), { error: "Bunch could not process this MCP request." });
  assert.deepEqual(failedLifecycle.calls, { connect: 1, close: 1 });
});
