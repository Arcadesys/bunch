import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { demoSystemSchema, getDemoSystem } from "./demo-system";

export const DEMO_TOOL_NAMES = new Set([
  "get_demo_system", "list_demo_people", "get_demo_person", "list_demo_tasks",
  "list_demo_notes", "get_demo_presence", "list_demo_history", "get_demo_catch_up",
]);

export function registerDemoSystemTool(server: McpServer) {
  server.registerTool("get_demo_system", {
    title: "Demo system",
    description: "Read Bunch's populated fictional Demo system: Fenton, Benny, Dot, shared tasks, separate hosting/fronting history, and a sample catch-up. Use for a demonstration or default walkthrough, never as the user's real records. Read-only; no sign-in needed.",
    inputSchema: {}, outputSchema: demoSystemSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: "noauth" }] },
  }, async () => ({ structuredContent: getDemoSystem(), content: [{ type: "text", text: "Demo system — fictional, read-only sample. This is not your private system." }] }));

  const personId = z.enum(["fenton", "benny", "dot"]);
  const metadata = { label: z.literal("Demo system"), fictional: z.literal(true), readOnly: z.literal(true) };
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const result = (data: Record<string, unknown>) => ({
    structuredContent: { label: "Demo system" as const, fictional: true as const, readOnly: true as const, ...data },
    content: [{ type: "text" as const, text: "Demo system — fictional, read-only records at the fixed sample date. Not the user's private data." }],
  });
  const _meta = { securitySchemes: [{ type: "noauth" }] };
  server.registerTool("list_demo_people", {
    title: "Demo system: people", description: "Explore the fictional Demo system's people and retrieve stable demo IDs. No private records.",
    inputSchema: {}, outputSchema: { ...metadata, people: demoSystemSchema.shape.people }, annotations, _meta,
  }, async () => result({ people: getDemoSystem().people }));
  server.registerTool("get_demo_person", {
    title: "Demo system: person details", description: "Read one fictional person's description, preferences, and relationships. Dot is no relation to Fenton or Benny.",
    inputSchema: z.object({ personId }).strict(), outputSchema: { ...metadata, person: demoSystemSchema.shape.people.element, relationships: demoSystemSchema.shape.relationships }, annotations, _meta,
  }, async ({ personId }) => { const demo = getDemoSystem(); return result({ person: demo.people.find(p => p.id === personId)!, relationships: demo.relationships.filter(r => r.people.includes(personId)) }); });
  server.registerTool("list_demo_tasks", {
    title: "Demo system: tasks", description: "Browse fictional tasks, optionally filtered by Relevant to person and OPEN/DONE status. Shared relevance is separate from who handles the work and from presence.",
    inputSchema: z.object({ relevantTo: personId.optional(), status: z.enum(["OPEN", "DONE"]).optional() }).strict(), outputSchema: { ...metadata, tasks: demoSystemSchema.shape.tasks }, annotations, _meta,
  }, async ({ relevantTo, status }) => result({ tasks: getDemoSystem().tasks.filter(t => (!relevantTo || t.relevantTo.includes(relevantTo)) && (!status || t.status === status)) }));
  server.registerTool("list_demo_notes", {
    title: "Demo system: notes", description: "Browse fictional notes and reminders, optionally filtering by recipient/relevance or author. Fenton reminds Benny to write about the gift the system received.",
    inputSchema: z.object({ relevantTo: personId.optional(), author: personId.optional() }).strict(), outputSchema: { ...metadata, notes: demoSystemSchema.shape.notes }, annotations, _meta,
  }, async ({ relevantTo, author }) => result({ notes: getDemoSystem().notes.filter(n => (!relevantTo || n.relevantTo.includes(relevantTo)) && (!author || n.author === author)) }));
  server.registerTool("get_demo_presence", {
    title: "Demo system: hosting and fronting", description: "Read the fixed fictional presence snapshot. Hosting is responsibility; fronting is presence and can overlap. This is not live personal presence.",
    inputSchema: {}, outputSchema: { ...metadata, asOf: z.string().datetime(), presence: demoSystemSchema.shape.presence }, annotations, _meta,
  }, async () => { const demo = getDemoSystem(); return result({ asOf: demo.asOf, presence: demo.presence }); });
  server.registerTool("list_demo_history", {
    title: "Demo system: history", description: "Explore fictional hosting/fronting periods, optionally filtered by person and kind. Open hosting continues after fronting ends. Missing records do not prove absence.",
    inputSchema: z.object({ personId: personId.optional(), kind: z.enum(["HOSTING", "FRONTING"]).optional() }).strict(), outputSchema: { ...metadata, asOf: z.string().datetime(), history: demoSystemSchema.shape.history }, annotations, _meta,
  }, async ({ personId, kind }) => { const demo = getDemoSystem(); return result({ asOf: demo.asOf, history: demo.history.filter(h => (!personId || h.personId === personId) && (!kind || h.kind === kind)) }); });
  server.registerTool("get_demo_catch_up", {
    title: "Demo system: catch-up", description: "Read the fictional saved-record catch-up for Benny's return. Fenton and Dot have no sample catch-up; return null for them rather than inventing one. Review state does not complete tasks.",
    inputSchema: z.object({ personId: personId.default("benny") }).strict(), outputSchema: { ...metadata, catchUp: demoSystemSchema.shape.catchUp.nullable() }, annotations, _meta,
  }, async ({ personId }) => result({ catchUp: personId === "benny" ? getDemoSystem().catchUp : null }));

}

export const connectPrivateSystemTool = {
  title: "Connect private system",
  description: "Sign in to use your own private Bunch system instead of the fictional Demo system. After connecting, refresh tools/list to discover the private tools. Existing authenticated access and tenant restrictions apply.",
  inputSchema: {},
  outputSchema: { mode: z.literal("private"), authenticated: z.literal(true) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: "oauth2", scopes: ["system:companion"] }] },
};

export function createDemoMcpServer() {
  const server = new McpServer({ name: "Bunch", version: "0.7.0" }, {
    instructions: "You are connected to Bunch's Demo system. Call get_demo_system for the default populated fictional sample. Label it Demo system and never treat it as the user's personal people, history, or commitments. No demo changes are saved. For personal records, call connect_private_system to authenticate, then refresh tools/list. Never substitute fictional data for a failed private request.",
  });
  registerDemoSystemTool(server);
  // The HTTP boundary challenges this tool before execution. Keep a closed
  // fallback here too, so an in-process caller cannot claim authentication.
  server.registerTool("connect_private_system", connectPrivateSystemTool, async () => ({ isError: true, content: [{ type: "text", text: "Authentication is required to connect your private system." }] }));
  return server;
}
