import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getFictionalDemo } from "./fictional-demo";

export function createFictionalDemoServer() {
  const server = new McpServer({ name: "bunch-fictional-demo", version: "1.0.0" });
  const reads = {
    get_demo_system: { description: "Read Demo system, a read-only fictional Bunch walkthrough with Foo, Bar, and Baz.", read: getFictionalDemo },
    list_alters: { description: "List the three fictional people in Demo system.", read: () => ({ systemName: "Demo system", people: getFictionalDemo().people }) },
    get_current_presence: { description: "Read fictional hosting responsibility and fronting presence separately. Never infer real presence from this example.", read: () => { const { hosting, fronting } = getFictionalDemo(); return { hosting, fronting }; } },
    list_notes: { description: "Read fictional notes and their shared relevance.", read: () => ({ notes: getFictionalDemo().notes }) },
    list_todos: { description: "Read the fictional shared picnic task.", read: () => ({ tasks: getFictionalDemo().tasks }) },
  };
  for (const [name, tool] of Object.entries(reads)) {
    server.registerTool(name, { description: tool.description, inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async () => ({ content: [{ type: "text" as const, text: JSON.stringify({ fictional: true, ...tool.read() }) }] }));
  }
  return server;
}
