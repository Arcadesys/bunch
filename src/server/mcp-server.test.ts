import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/server/mcp-server";
import type { SystemService } from "@/server/system-service";

test("MCP descriptors expose exact schemas and safety annotations", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("test:descriptor", {} as SystemService);
  const client = new Client({ name: "descriptor-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 20);
    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} must declare outputSchema`);
      assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} must be closed-world`);
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal((byName.get("render_system_companion")?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, "ui://system.arcades.me/companion-v8.html");
    for (const name of ["get_current_front", "list_system_notes", "list_alters", "get_alter", "list_todos", "get_todo", "preview_erase_alter"]) assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} must be read-only`);
    for (const name of ["erase_alter", "erase_todo", "erase_coverage_record"]) assert.equal(byName.get(name)?.annotations?.destructiveHint, true, `${name} must be destructive`);
    for (const name of ["switch_current_front", "create_system_note", "create_alter", "update_alter", "archive_alter", "restore_alter", "erase_alter", "create_todo", "update_todo", "archive_todo", "restore_todo", "erase_todo", "set_note_alter", "reassign_coverage", "erase_coverage_record"]) assert.equal(byName.get(name)?.annotations?.idempotentHint, true, `${name} must be retry-safe`);
    const resources = await client.listResources();
    const widget = resources.resources.find((resource) => resource.uri === "ui://system.arcades.me/companion-v8.html");
    assert.ok(widget, "the v8 companion widget must be registered");
    const widgetContent = await client.readResource({ uri: widget.uri });
    const content = widgetContent.contents[0];
    const html = "text" in content ? content.text : "";
    assert.deepEqual(content._meta?.ui, {
      csp: { connectDomains: ["https://system-arcades-me.vercel.app"], resourceDomains: [] },
      prefersBorder: true,
    });
    assert.deepEqual(content._meta?.["openai/widgetCSP"], {
      connect_domains: ["https://system-arcades-me.vercel.app"],
      resource_domains: [],
    });
    assert.match(html, /id="local-image"/);
    assert.match(html, /window\.openai\?\.selectFiles/);
    assert.match(html, /ui\/notifications\/tool-result'\)render\(m\.params\?\.structuredContent\)/);
    assert.doesNotMatch(html, /ui\/notifications\/tool-result'\)render\(m\.params\?\.result\)/);
  } finally {
    await client.close();
    await server.close();
  }
});
