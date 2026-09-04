import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/server/mcp-server";
import type { SystemService } from "@/server/system-service";

test("MCP descriptors expose exact schemas and safety annotations", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("demo:descriptor", {} as SystemService);
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
    assert.equal((byName.get("render_system_companion")?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, "ui://system-arcades-me.vercel.app/companion-v10.html");
    for (const name of ["get_current_front", "list_system_notes", "list_alters", "get_alter", "list_todos", "get_todo", "preview_erase_alter", "open_private_photo_gallery", "prepare_conversation_catch_up"]) assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} must be read-only`);
    assert.ok(byName.get("prepare_conversation_catch_up")?.outputSchema?.properties?.historyAccess, "conversation handoff must disclose host access");
    const handoff = await client.callTool({ name: "prepare_conversation_catch_up", arguments: { alterId: "11111111-1111-4111-8111-111111111111", startAt: "2026-09-03T14:00:00-05:00", endAt: "2026-09-04T10:15:00-05:00", timeZone: "America/Chicago" } });
    assert.equal((handoff.structuredContent as { historyAccess?: string }).historyAccess, "HOST_REQUIRED");
    assert.equal((handoff.structuredContent as { window?: { provenance?: string } }).window?.provenance, "USER_SELECTED");
    assert.ok(byName.get("open_private_photo_gallery")?.outputSchema?.properties?.url, "gallery fallback must return a URL");
    const gallery = await client.callTool({ name: "open_private_photo_gallery", arguments: {} });
    assert.deepEqual(gallery.structuredContent, { url: "https://system-arcades-me.vercel.app/gallery" });
    for (const name of ["erase_alter", "erase_todo", "erase_coverage_record"]) assert.equal(byName.get(name)?.annotations?.destructiveHint, true, `${name} must be destructive`);
    for (const name of ["switch_current_front", "create_system_note", "create_alter", "update_alter", "archive_alter", "restore_alter", "erase_alter", "create_todo", "update_todo", "archive_todo", "restore_todo", "erase_todo", "set_note_alter", "reassign_coverage", "erase_coverage_record"]) assert.equal(byName.get(name)?.annotations?.idempotentHint, true, `${name} must be retry-safe`);
    const resources = await client.listResources();
    const widget = resources.resources.find((resource) => resource.uri === "ui://system-arcades-me.vercel.app/companion-v10.html");
    assert.ok(widget, "the v10 companion widget must be registered");
    const legacyWidgets = ["ui://system.arcades.me/companion-v7.html", "ui://system.arcades.me/companion-v8.html"].map((uri) => resources.resources.find((resource) => resource.uri === uri));
    assert.ok(legacyWidgets.every(Boolean), "the cached v7 and v8 companion URIs must remain readable during the transition");
    const widgetContent = await client.readResource({ uri: widget.uri });
    const legacyWidgetContents = await Promise.all(legacyWidgets.map((resource) => client.readResource({ uri: resource!.uri })));
    const content = widgetContent.contents[0];
    const html = "text" in content ? content.text : "";
    const legacyHtml = legacyWidgetContents.map((result) => "text" in result.contents[0] ? result.contents[0].text : "");
    assert.deepEqual(content._meta?.ui, {
      csp: { connectDomains: ["https://system-arcades-me.vercel.app"], resourceDomains: ["https://system-arcades-me.vercel.app"] },
      prefersBorder: true,
    });
    assert.deepEqual(content._meta?.["openai/widgetCSP"], {
      connect_domains: ["https://system-arcades-me.vercel.app"],
      resource_domains: ["https://system-arcades-me.vercel.app"],
    });
    assert.match(html, /id="local-image"/);
    assert.match(html, /window\.openai\?\.selectFiles/);
    assert.match(html, /Private picture gallery/);
    assert.match(html, /imageManifest/);
    assert.match(html, /image\.src/);
    for (const cachedHtml of legacyHtml) assert.match(cachedHtml, /Private picture gallery/);
    assert.match(html, /ui\/notifications\/tool-result'\)render\(m\.params\?\.structuredContent,m\.params\?\._meta/);
    assert.doesNotMatch(html, /ui\/notifications\/tool-result'\)render\(m\.params\?\.result\)/);
  } finally {
    await client.close();
    await server.close();
  }
});
