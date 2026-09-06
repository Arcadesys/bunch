import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/server/mcp-server";
import { CatchUpService } from "@/server/catch-up-service";
import type { SystemService } from "@/server/system-service";

test("MCP descriptors expose exact schemas and safety annotations", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const service = { getCurrentPresence: async () => ({hosting:null,fronting:[],legacyCurrentFront:null}),
    getCurrentFront: async () => null, listAlters: async () => ({ data: [] }) } as unknown as SystemService;
  const catchUp = new CatchUpService({} as never);
  catchUp.openForPresence = async () => null;
  catchUp.openForCurrentFronter = async () => null;
  const server = createMcpServer("demo:descriptor", service, catchUp, { listProfiles: async () => [] });
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
    assert.equal((byName.get("render_system_companion")?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, "ui://system-arcades-me.vercel.app/companion-v13.html");
    for (const name of ["get_current_front", "list_system_notes", "list_alters", "get_alter", "list_todos", "get_todo", "preview_erase_alter", "open_private_photo_gallery", "prepare_conversation_catch_up", "get_catch_up", "render_alter_lineup"]) assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} must be read-only`);
    assert.ok(byName.get("prepare_conversation_catch_up")?.outputSchema?.properties?.historyAccess, "conversation handoff must disclose host access");
    assert.equal(byName.get("prepare_furry_transform")?.annotations?.readOnlyHint, true, "transform preparation must not change private state");
    assert.equal(byName.get("set_alter_appearance")?.annotations?.idempotentHint, true, "appearance selection must be retry-safe");
    const handoff = await client.callTool({ name: "prepare_conversation_catch_up", arguments: { alterId: "11111111-1111-4111-8111-111111111111", startAt: "2026-09-03T14:00:00-05:00", endAt: "2026-09-04T10:15:00-05:00", timeZone: "America/Chicago" } });
    assert.equal((handoff.structuredContent as { elapsedSeconds: number }).elapsedSeconds, 72900);
    assert.equal((handoff.structuredContent as { historyAccess?: string }).historyAccess, "HOST_REQUIRED");
    assert.equal((handoff.structuredContent as { window?: { provenance?: string } }).window?.provenance, "USER_SELECTED");
    assert.ok(byName.get("open_private_photo_gallery")?.outputSchema?.properties?.url, "gallery fallback must return a URL");
    const gallery = await client.callTool({ name: "open_private_photo_gallery", arguments: {} });
    assert.deepEqual(gallery.structuredContent, { url: "https://system-arcades-me.vercel.app/gallery" });
    for (const name of ["erase_alter", "erase_todo", "erase_coverage_record"]) assert.equal(byName.get(name)?.annotations?.destructiveHint, true, `${name} must be destructive`);
    for (const name of ["switch_current_front", "create_system_note", "create_alter", "update_alter", "archive_alter", "restore_alter", "erase_alter", "create_todo", "update_todo", "archive_todo", "restore_todo", "erase_todo", "set_note_alter", "reassign_coverage", "erase_coverage_record"]) assert.equal(byName.get(name)?.annotations?.idempotentHint, true, `${name} must be retry-safe`);
    for (const name of ["set_catch_up_item_state", "suggest_important_thread", "confirm_important_thread"]) {
      assert.equal(byName.get(name)?.annotations?.idempotentHint, true);
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, false);
    }
    assert.match(byName.get("suggest_important_thread")?.description ?? "", /does not enter catch-up until confirmed/);
    assert.match(byName.get("confirm_important_thread")?.description ?? "", /after the user approves/);
    const catchUpResult = await client.callTool({ name: "get_catch_up", arguments: {} });
    assert.deepEqual(catchUpResult.structuredContent, { data: null, meta: {} });
    const renderedCatchUp = await client.callTool({ name: "render_system_companion", arguments: {} });
    assert.deepEqual(renderedCatchUp.structuredContent, { catchUp: null, presence:{hosting:null,fronting:[],legacyCurrentFront:null} });
    const lineup = await client.callTool({ name: "render_alter_lineup", arguments: {} });
    assert.deepEqual(lineup.structuredContent, { currentFront: null, profiles: [], presence:{hosting:null,fronting:[],legacyCurrentFront:null} });
    assert.deepEqual(lineup._meta, { privateImages: [] });
    assert.equal((byName.get("render_alter_lineup")?._meta?.ui as { resourceUri?: string })?.resourceUri, "ui://system-arcades-me.vercel.app/alter-lineup-v2.html");
    const resources = await client.listResources();
    const widget = resources.resources.find((resource) => resource.uri === "ui://system-arcades-me.vercel.app/companion-v13.html");
    assert.ok(widget, "the v13 companion widget must be registered");
    for (const uri of ["ui://system-arcades-me.vercel.app/companion-v11.html", "ui://system-arcades-me.vercel.app/companion-v12.html", "ui://system-arcades-me.vercel.app/alter-lineup-v1.html"]) {
      const priorResource = await client.readResource({ uri });
      assert.ok(priorResource.contents.length, `${uri} must remain readable`);
    }
    const legacyWidgets = ["ui://system-arcades-me.vercel.app/companion-v10.html", "ui://system.arcades.me/companion-v7.html", "ui://system.arcades.me/companion-v8.html"].map((uri) => resources.resources.find((resource) => resource.uri === uri));
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
    assert.match(html, /Bunch/);
    assert.match(html, /Catch-up tasks/);
    assert.match(html, /Mark reviewed/);
    assert.doesNotMatch(html, />Finish review</);
    assert.match(html, /set_catch_up_item_state/);
    const lineupResource = await client.readResource({ uri: "ui://system-arcades-me.vercel.app/alter-lineup-v2.html" });
    const lineupHtml = "text" in lineupResource.contents[0] ? lineupResource.contents[0].text : "";
    assert.match(lineupHtml, /isProfilePicture/);
    assert.match(lineupHtml, /HOSTING/);
    for (const cachedHtml of legacyHtml) {
      assert.match(cachedHtml, /Private picture gallery/);
      assert.match(cachedHtml, /id="local-image"/);
      assert.match(cachedHtml, /window\.openai\?\.selectFiles/);
      assert.match(cachedHtml, /imageManifest/);
      assert.match(cachedHtml, /image\.src/);
      assert.match(cachedHtml, /ui\/notifications\/tool-result'\)render\(m\.params\?\.structuredContent,m\.params\?\._meta/);
      assert.doesNotMatch(cachedHtml, /ui\/notifications\/tool-result'\)render\(m\.params\?\.result\)/);
    }
  } finally {
    await client.close();
    await server.close();
  }
});

test("lineup keeps private image capabilities in widget metadata only", async () => {
  const priorSecret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "widget-metadata-test-secret-only";
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const service = { getCurrentPresence: async () => ({hosting:null,fronting:[],legacyCurrentFront:null}),
    getCurrentFront: async () => null, listAlters: async () => ({ data: [] }) } as unknown as SystemService;
  const server = createMcpServer("demo:image-metadata", service, undefined, { listProfiles: async () => [{
    id: "11111111-1111-4111-8111-111111111111", ownerId: "demo:image-metadata", name: "Example", version: 1,
    createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z",
    images: [{ id: "22222222-2222-4222-8222-222222222222", storageKey: "private-test-key", contentType: "image/png", isProfilePicture: true, createdAt: "2026-09-01T12:00:00Z" }],
  }] });
  const client = new Client({ name: "metadata-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "render_alter_lineup", arguments: {} });
    const images = result._meta?.privateImages as Array<{ isProfilePicture: boolean; src: string }>;
    assert.equal(images.length, 1);
    assert.equal(images[0].isProfilePicture, true);
    assert.match(images[0].src, /\/api\/system\/images\/inline\/.*\?cap=/);
    assert.doesNotMatch(JSON.stringify({ content: result.content, structuredContent: result.structuredContent }), /cap=|private-test-key|image:read/);
    assert.doesNotMatch(JSON.stringify(result), /private-test-key/);
  } finally {
    if (priorSecret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = priorSecret;
    await client.close();
    await server.close();
  }
});

test("Furry transform preparation keeps selected reference media out of model-visible output", async () => {
  const priorSecret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "furry-transform-metadata-test-secret";
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const profile = { id: "11111111-1111-4111-8111-111111111111", name: "Melody Arcade", aliases: ["Melody"], strengths: [], boundaries: [], images: [], imageCount: 1, appearanceNotes: "Use the approved character references.", appearanceReferenceImageIds: ["22222222-2222-4222-8222-222222222222"], version: 1, createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z" };
  const service = { listAlters: async () => ({ data: [profile] }) } as unknown as SystemService;
  const server = createMcpServer("demo:furry-transform", service, undefined, { listProfiles: async () => [{ ...profile, ownerId: "demo:furry-transform", images: [{ id: "22222222-2222-4222-8222-222222222222", storageKey: "private-reference-key", contentType: "image/png", isProfilePicture: false, createdAt: "2026-09-01T12:00:00Z" }] }] });
  const client = new Client({ name: "furry-transform-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "prepare_furry_transform", arguments: { alterName: "Melody Arcade" } });
    assert.deepEqual(result.structuredContent, { alter: { id: profile.id, name: profile.name, appearanceNotes: profile.appearanceNotes }, referenceCount: 1, snapshotRequired: true, mediaHandoff: "HOST_ADAPTER_REQUIRED" });
    assert.doesNotMatch(JSON.stringify({ content: result.content, structuredContent: result.structuredContent }), /cap=|private-reference-key|image:read/);
    assert.match((result._meta?.referenceMedia as Array<{ src: string }>)[0].src, /\/api\/system\/images\/inline\/.*\?cap=/);
  } finally {
    if (priorSecret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = priorSecret;
    await client.close();
    await server.close();
  }
});

test("lineup follows pagination to include every active profile", async () => {
  const calls: Array<{ limit?: number; cursor?: string }> = [];
  const profile = (id: string, name: string) => ({ id, name, aliases: [], strengths: [], boundaries: [], images: [], appearanceReferenceImageIds: [], imageCount: 0, version: 1, createdAt: "2026-09-01T12:00:00Z", updatedAt: "2026-09-01T12:00:00Z" });
  const service = {
    getCurrentPresence: async () => ({hosting:null,fronting:[],legacyCurrentFront:null}),
    getCurrentFront: async () => null,
    listAlters: async (_ownerId: string, input: { limit?: number; cursor?: string }) => {
      calls.push(input);
      return input.cursor ? { data: [profile("22222222-2222-4222-8222-222222222222", "Second")] } : { data: [profile("11111111-1111-4111-8111-111111111111", "First")], nextCursor: "next-page" };
    },
  } as unknown as SystemService;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("demo:pagination", service, undefined, { listProfiles: async () => [] });
  const client = new Client({ name: "pagination-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "render_alter_lineup", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.deepEqual((result.structuredContent as { profiles: Array<{ name: string }> }).profiles.map(item => item.name), ["First", "Second"]);
    assert.deepEqual(calls, [{ limit: 100, cursor: undefined }, { limit: 100, cursor: "next-page" }]);
  } finally {
    await client.close();
    await server.close();
  }
});
