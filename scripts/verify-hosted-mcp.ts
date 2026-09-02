import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";

const endpoint = process.env.HOSTED_MCP_URL;
const token = process.env.HOSTED_MCP_ACCESS_TOKEN;
if (!endpoint || !token) throw new Error("HOSTED_MCP_URL and a valid Auth0 HOSTED_MCP_ACCESS_TOKEN are required.");

const transport = new StreamableHTTPClientTransport(new URL(endpoint), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
const client = new Client({ name: "system-hosted-acceptance", version: "1.0.0" });

type Alter = { id: string; version: number; name: string };
type Todo = { id: string; version: number; title: string };
let alter: Alter | undefined;
let todo: Todo | undefined;

function data<T>(result: Awaited<ReturnType<Client["callTool"]>>) {
  const structured = result.structuredContent as { data?: T } | undefined;
  if (!structured?.data) throw new Error("Hosted MCP tool did not return structured data.");
  return structured.data;
}

async function main() {
try {
  await client.connect(transport);
  const tools = await client.listTools();
  for (const name of ["get_current_front", "switch_current_front", "list_system_notes", "create_system_note", "render_system_companion", "create_alter", "list_alters", "update_alter", "create_todo", "list_todos", "erase_todo", "preview_erase_alter", "erase_alter"]) {
    if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Hosted MCP is missing ${name}.`);
  }

  const skillCatalog = await client.request(
    { method: "skills/list", params: {} },
    z.object({ skills: z.array(z.object({ uri: z.string(), frontmatter: z.record(z.string(), z.unknown()), resources: z.array(z.object({ uri: z.string(), digest: z.string() })) })) }),
  );
  if (!skillCatalog.skills.some((skill) => skill.frontmatter.name === "system-companion")) throw new Error("Hosted MCP is missing the System Companion skill.");
  const resources = await client.listResources();
  const widget = resources.resources.find((resource) => resource.uri === "ui://system.arcades.me/companion-v8.html");
  if (!widget) throw new Error("Hosted MCP is missing the v6 companion widget.");
  const widgetResult = await client.readResource({ uri: widget.uri });
  const widgetHtml = "text" in widgetResult.contents[0] ? widgetResult.contents[0].text : "";
  if (!widgetHtml.includes('id="local-image"')) throw new Error("Hosted companion widget is missing its desktop/web file-picker fallback.");

  console.log("Natural-language case: Show my private System notes.");
  const noteResult = (await client.callTool({ name: "list_system_notes", arguments: { limit: 1 } })).structuredContent as { data?: unknown[] } | undefined;
  if (!Array.isArray(noteResult?.data)) throw new Error("Hosted note read did not return its structured contract.");

  console.log("Natural-language case: Create an alter named Hosted Acceptance.");
  alter = data<Alter>(await client.callTool({ name: "create_alter", arguments: { requestId: randomUUID(), name: "Hosted Acceptance", aliases: ["Hosted Test"] } }));

  console.log("Natural-language case: Who is fronting right now?");
  const currentResult = (await client.callTool({ name: "get_current_front", arguments: {} })).structuredContent as { data?: unknown } | undefined;
  if (!currentResult || !("data" in currentResult)) throw new Error("Hosted current-front read did not return its structured contract.");

  console.log("Natural-language case: Find the alter called Hosted Test.");
  const foundAlters = data<Alter[]>(await client.callTool({ name: "list_alters", arguments: { search: "Hosted Test" } }));
  if (foundAlters[0]?.id !== alter.id) throw new Error("Hosted alias lookup returned the wrong alter.");

  console.log("Natural-language case: Add communication guidance to Hosted Acceptance.");
  alter = data<Alter>(await client.callTool({ name: "update_alter", arguments: { alterId: alter.id, requestId: randomUUID(), expectedVersion: alter.version, communicationGuidance: "Use a concise written handoff." } }));

  console.log("Natural-language case: Give Hosted Acceptance a high-priority todo.");
  todo = data<Todo>(await client.callTool({ name: "create_todo", arguments: { requestId: randomUUID(), title: "Verify hosted MCP", priority: "HIGH", status: "OPEN", assigneeAlterIds: [alter.id] } }));
  const foundTodos = data<Todo[]>(await client.callTool({ name: "list_todos", arguments: { priority: ["HIGH"], assigneeAlterId: alter.id } }));
  if (foundTodos[0]?.id !== todo.id) throw new Error("Hosted todo filter returned the wrong todo.");

  console.log("Natural-language case: Permanently remove the hosted test todo and alter.");
  await client.callTool({ name: "erase_todo", arguments: { todoId: todo.id, requestId: randomUUID(), expectedVersion: todo.version } });
  todo = undefined;
  const preview = data<{ version: number; canErase: boolean; previewToken?: string }>(await client.callTool({ name: "preview_erase_alter", arguments: { alterId: alter.id } }));
  if (!preview.canErase || !preview.previewToken) throw new Error("Hosted alter erasure preview was unexpectedly blocked.");
  await client.callTool({ name: "erase_alter", arguments: { alterId: alter.id, requestId: randomUUID(), expectedVersion: preview.version, previewToken: preview.previewToken } });
  alter = undefined;
  console.log("Hosted MCP CRUD acceptance passed and test records were erased.");
} finally {
  if (todo) await client.callTool({ name: "erase_todo", arguments: { todoId: todo.id, requestId: randomUUID(), expectedVersion: todo.version } }).catch(() => undefined);
  if (alter) {
    const previewResult = await client.callTool({ name: "preview_erase_alter", arguments: { alterId: alter.id } }).catch(() => undefined);
    if (previewResult) {
      const preview = data<{ version: number; canErase: boolean; previewToken?: string }>(previewResult);
      if (preview.canErase && preview.previewToken) await client.callTool({ name: "erase_alter", arguments: { alterId: alter.id, requestId: randomUUID(), expectedVersion: preview.version, previewToken: preview.previewToken } }).catch(() => undefined);
    }
  }
  await client.close().catch(() => undefined);
}
}

void main();
