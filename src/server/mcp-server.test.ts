import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/server/mcp-server";
import type { SystemService } from "@/server/system-service";
import { imagePromptResultSchema } from "@/domain/image-prompt";

test("MCP descriptors expose exact schemas and safety annotations", async () => {
  const originalSigningSecret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "test-signing-secret-with-enough-entropy";
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const profileId = "11111111-1111-4111-8111-111111111111";
  const now = "2026-09-03T12:00:00.000Z";
  const testService = {
    getCurrentFront: async () => ({ id: "22222222-2222-4222-8222-222222222222", alterId: profileId, alterName: "Mouse Arcade", startedAt: now, version: 1 }),
    listAlters: async () => ({ data: [{ id: profileId, name: "Mouse Arcade", aliases: [], pronouns: "they/them", description: "System member", strengths: [], boundaries: [], imageCount: 1, images: [], version: 1, createdAt: now, updatedAt: now }] }),
    getAlter: async () => ({ id: profileId, name: "Mouse Arcade", aliases: [], strengths: [], boundaries: [], imageCount: 1, images: [{ id: "33333333-3333-4333-8333-333333333333", contentType: "image/png", isProfilePicture: true, createdAt: now }], profilePicture: { id: "33333333-3333-4333-8333-333333333333", contentType: "image/png", isProfilePicture: true, createdAt: now }, appearanceReference: { id: "33333333-3333-4333-8333-333333333333", contentType: "image/png", isProfilePicture: true, createdAt: now }, version: 1, createdAt: now, updatedAt: now }),
  } as unknown as SystemService;
  const server = createMcpServer("test:descriptor", testService, undefined, { listProfiles: async () => [] });
  const client = new Client({ name: "descriptor-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.equal(client.getServerVersion()?.name, "DIDdy");
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 20);
    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} must declare outputSchema`);
      assert.equal(tool.annotations?.openWorldHint, false, `${tool.name} must be closed-world`);
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal((byName.get("render_system_companion")?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, "ui://system-arcades-me.vercel.app/companion-v12.html");
    for (const name of ["render_alter_lineup", "get_catch_up", "set_catch_up_item_state", "suggest_important_thread", "confirm_important_thread", "create_system_decision", "prepare_group_photo_render"]) assert.ok(byName.has(name), `${name} should be registered`);
    assert.equal((byName.get("render_alter_lineup")?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, "ui://system-arcades-me.vercel.app/alter-lineup-v2.html");
    for (const name of ["get_system_host", "get_current_front", "list_system_notes", "list_alters", "get_alter", "list_todos", "get_todo", "preview_erase_alter", "open_private_photo_gallery", "render_alter_lineup", "prepare_group_photo_render"]) assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} must be read-only`);
    assert.ok(byName.get("open_private_photo_gallery")?.outputSchema?.properties?.url, "gallery fallback must return a URL");
    const gallery = await client.callTool({ name: "open_private_photo_gallery", arguments: {} });
    assert.deepEqual(gallery.structuredContent, { url: "https://system-arcades-me.vercel.app/gallery" });
    const lineup = await client.callTool({ name: "render_alter_lineup", arguments: {} });
    assert.ok(lineup.structuredContent, JSON.stringify(lineup));
    assert.equal((lineup.structuredContent as { profiles: Array<{ name: string }> }).profiles[0].name, "Mouse Arcade");
    const lineupContent = lineup.content as Array<{ type: string; text?: string }> | undefined;
    assert.match(lineupContent?.[0]?.text ?? "", /Prepared 1 active alter profile/);
    const transform = await client.callTool({ name: "prepare_furry_transform", arguments: { alterId: profileId } });
    const prepared = imagePromptResultSchema.parse(transform.structuredContent);
    assert.equal(prepared.ready, true);
    assert.equal(prepared.identities[0].alterId, profileId);
    assert.equal(prepared.identities[0].alterName, "Mouse Arcade");
    assert.match(prepared.prompt, /Canonical visual identity/);
    assert.equal(byName.get("prepare_alter_image_prompt")?.annotations?.readOnlyHint, true);
    const prompt = await client.callTool({ name: "prepare_alter_image_prompt", arguments: { scene: "Group portrait", alters: "all" } });
    assert.equal(imagePromptResultSchema.parse(prompt.structuredContent).status, "NEEDS_INFORMATION");
    assert.match(JSON.stringify(transform._meta), /character_reference/);
    for (const name of ["erase_alter", "erase_todo", "erase_coverage_record"]) assert.equal(byName.get(name)?.annotations?.destructiveHint, true, `${name} must be destructive`);
    for (const name of ["set_system_host", "switch_current_front", "create_system_note", "create_alter", "update_alter", "set_profile_picture", "set_alter_appearance", "prepare_profile_picture_upload", "prepare_furry_result_upload", "archive_alter", "restore_alter", "erase_alter", "create_todo", "update_todo", "archive_todo", "restore_todo", "erase_todo", "set_note_alter", "reassign_coverage", "erase_coverage_record", "set_catch_up_item_state", "suggest_important_thread", "confirm_important_thread", "create_system_decision"]) assert.equal(byName.get(name)?.annotations?.idempotentHint, true, `${name} must be retry-safe`);
    const resources = await client.listResources();
    const widget = resources.resources.find((resource) => resource.uri === "ui://system-arcades-me.vercel.app/companion-v12.html");
    const lineupWidget = resources.resources.find((resource) => resource.uri === "ui://system-arcades-me.vercel.app/alter-lineup-v2.html");
    assert.ok(widget, "the v12 companion widget must be registered");
    assert.ok(lineupWidget, "the alter lineup widget must be registered");
    const legacyWidgets = ["ui://system.arcades.me/companion-v7.html", "ui://system.arcades.me/companion-v8.html", "ui://system-arcades-me.vercel.app/companion-v10.html", "ui://system-arcades-me.vercel.app/companion-v11.html"].map((uri) => resources.resources.find((resource) => resource.uri === uri));
    assert.ok(legacyWidgets.every(Boolean), "cached widget URIs must remain readable during the transition");
    const widgetContent = await client.readResource({ uri: widget.uri });
    const lineupWidgetContent = await client.readResource({ uri: lineupWidget.uri });
    const cachedLineup = await client.readResource({ uri: "ui://system-arcades-me.vercel.app/alter-lineup-v1.html" });
    assert.ok("text" in cachedLineup.contents[0]);
    assert.ok("text" in lineupWidgetContent.contents[0]);
    assert.equal(cachedLineup.contents[0].text, lineupWidgetContent.contents[0].text);
    const legacyWidgetContents = await Promise.all(legacyWidgets.map((resource) => client.readResource({ uri: resource!.uri })));
    const content = widgetContent.contents[0];
    const html = "text" in content ? content.text : "";
    const legacyHtml = legacyWidgetContents.map((result) => "text" in result.contents[0] ? result.contents[0].text : "");
    assert.deepEqual(content._meta?.ui, {
      csp: { connectDomains: ["https://system-arcades-me.vercel.app"], resourceDomains: ["https://system-arcades-me.vercel.app"] },
      prefersBorder: true,
      domain: "https://system-arcades-me.vercel.app",
    });
    assert.deepEqual(content._meta?.["openai/widgetCSP"], {
      connect_domains: ["https://system-arcades-me.vercel.app"],
      resource_domains: ["https://system-arcades-me.vercel.app"],
      redirect_domains: ["https://system-arcades-me.vercel.app", "https://chatgpt.com"],
    });
    assert.match(html, /Catch-up for/);
    assert.match(html, /set_catch_up_item_state/);
    assert.match(html, /Review actions do not complete tasks or change saved notes/);
    assert.match(html, /Next switch/);
    assert.match(html, /Save this thread/);
    const lineupHtml = "text" in lineupWidgetContent.contents[0] ? lineupWidgetContent.contents[0].text : "";
    assert.match(lineupHtml, /Alter lineup/);
    assert.match(lineupHtml, /privateImages/);
    assert.match(lineupHtml, /split\(\/\\s\+\//);
    assert.doesNotMatch(JSON.stringify(lineupWidgetContent.contents[0]._meta?.ui), /redirectDomains/);
    for (const cachedHtml of legacyHtml) assert.match(cachedHtml, /Profiles and profile pictures/);
    assert.match(html, /ui\/notifications\/tool-result/);
  } finally {
    await client.close();
    await server.close();
    if (originalSigningSecret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = originalSigningSecret;
  }
});
