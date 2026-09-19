import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.HOSTED_MCP_URL;
if (!endpoint) throw new Error("HOSTED_MCP_URL is required.");

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
