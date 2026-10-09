import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.HOSTED_MCP_URL;
if (!endpoint) throw new Error("HOSTED_MCP_URL is required.");

function requireString(value: unknown, label: string) {
  if (typeof value !== "string" || !value) throw new Error(`Hosted OAuth metadata is missing ${label}.`);
  return value;
}

function requireStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) {
    throw new Error(`Hosted OAuth metadata has invalid ${label}.`);
  }
  return value;
}

function rpc(name: string, authorization?: string) {
  return fetch(endpoint!, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } }),
  });
}

async function main() {
  const endpointUrl = new URL(endpoint);
  const metadataResponse = await fetch(new URL("/.well-known/oauth-protected-resource", endpointUrl));
  if (!metadataResponse.ok) throw new Error("Hosted protected-resource metadata is unavailable.");
  const metadata = await metadataResponse.json() as Record<string, unknown>;
  if (metadata.resource !== endpointUrl.href.replace(/\/$/, "")) throw new Error("Hosted OAuth resource does not match the MCP endpoint.");
  const resourceScopes = requireStringArray(metadata.scopes_supported, "resource scopes");
  for (const scope of ["system:companion", "openid", "profile", "email", "offline_access"]) {
    if (!resourceScopes.includes(scope)) throw new Error(`Hosted protected-resource metadata is missing ${scope}.`);
  }

  const authorizationServer = requireString(requireStringArray(metadata.authorization_servers, "authorization servers")[0], "authorization server");
  const authorizationMetadataResponse = await fetch(new URL(".well-known/oauth-authorization-server", authorizationServer));
  if (!authorizationMetadataResponse.ok) throw new Error("Hosted authorization-server metadata is unavailable.");
  const authorizationMetadata = await authorizationMetadataResponse.json() as Record<string, unknown>;
  if (authorizationMetadata.issuer !== authorizationServer) throw new Error("OAuth issuer does not match protected-resource metadata.");
  if (authorizationMetadata.authorization_response_iss_parameter_supported !== true) throw new Error("OAuth authorization responses do not advertise issuer identification.");
  if (authorizationMetadata.client_id_metadata_document_supported !== true) throw new Error("OAuth authorization server does not advertise CIMD support.");
  if (!requireStringArray(authorizationMetadata.code_challenge_methods_supported, "PKCE methods").includes("S256")) throw new Error("OAuth authorization server does not advertise PKCE S256.");
  if (!requireStringArray(authorizationMetadata.token_endpoint_auth_methods_supported, "token authentication methods").includes("private_key_jwt")) throw new Error("OAuth authorization server does not accept private_key_jwt.");
  if (!requireStringArray(authorizationMetadata.scopes_supported, "authorization scopes").includes("offline_access")) throw new Error("OAuth authorization server does not advertise offline_access.");

  const clientMetadataResponse = await fetch("https://chatgpt.com/oauth/client.json");
  if (!clientMetadataResponse.ok) throw new Error("ChatGPT CIMD metadata is unavailable.");
  const clientMetadata = await clientMetadataResponse.json() as Record<string, unknown>;
  if (!requireStringArray(clientMetadata.token_endpoint_auth_methods_supported, "ChatGPT token authentication methods").includes("private_key_jwt")) throw new Error("ChatGPT CIMD metadata does not advertise private_key_jwt.");
  if (clientMetadata.jwks_uri !== "https://chatgpt.com/oauth/jwks.json") throw new Error("ChatGPT CIMD metadata has an unexpected JWKS URL.");

  const client = new Client({ name: "bunch-public-hosted-check", version: "1.0.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    const listed = await client.listTools();
    for (const name of ["get_demo_system", "list_demo_people", "connect_private_system"]) {
      if (!listed.tools.some(tool => tool.name === name)) throw new Error(`Hosted public MCP is missing ${name}.`);
    }
    const demoResult = await client.callTool({ name: "get_demo_system", arguments: {} });
    const demo = demoResult.structuredContent as { label?: unknown; people?: Array<{ name?: unknown }> } | undefined;
    if (demo?.label !== "Demo system" || demo.people?.map(person => person.name).join(",") !== "Fenton,Benny,Dot") {
      throw new Error("Hosted public MCP returned an unexpected Demo system.");
    }
  } finally {
    await client.close().catch(() => undefined);
  }

  const connectResponse = await rpc("connect_private_system");
  if (connectResponse.status !== 200) throw new Error("Hosted connection bootstrap did not return an MCP tool result.");
  const connectPayload = await connectResponse.json() as { result?: { isError?: unknown; _meta?: Record<string, unknown> } };
  const challenges = connectPayload.result?._meta?.["mcp/www_authenticate"];
  if (connectPayload.result?.isError !== true || !Array.isArray(challenges) || !challenges.some(challenge =>
    typeof challenge === "string"
      && challenge.includes('resource_metadata=')
      && challenge.includes('scope="system:companion"')
      && challenge.includes('error="invalid_token"')
      && challenge.includes('error_description='))) {
    throw new Error("Hosted connection bootstrap did not return the expected tool-level OAuth challenge.");
  }
  const privateResponse = await rpc("list_alters");
  if (privateResponse.status !== 401 || !privateResponse.headers.get("www-authenticate")?.includes("Bearer")) {
    throw new Error("Hosted private tools did not return the expected OAuth challenge.");
  }
  const invalidResponse = await rpc("get_demo_system", "Bearer invalid");
  const invalidText = await invalidResponse.text();
  if (invalidResponse.status !== 401 || /Fenton|Benny|Dot/.test(invalidText)) {
    throw new Error("An invalid credential reached Demo system data.");
  }
  console.log("Hosted public MCP verification passed without credentials or mutations.");
}

void main();
