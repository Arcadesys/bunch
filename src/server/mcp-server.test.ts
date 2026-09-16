import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/server/mcp-server";
import { CatchUpService } from "@/server/catch-up-service";
import type { SystemService } from "@/server/system-service";
import type { NativeSceneService } from "@/server/native-scene-service";

// The MCP server has no default origin, so every test that builds one must say
// where this instance is served from. Pinned rather than defaulted: these
// assertions must not change with whatever origin the shell happens to export.
process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch.example";

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
    assert.equal(client.getServerVersion()?.name, "Working Monkeys");
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 20);
    for (const tool of tools) {
      assert.ok(tool.outputSchema, `${tool.name} must declare outputSchema`);
      assert.equal(tool.annotations?.openWorldHint, tool.name === "generate_scene", `${tool.name} must declare its external-provider boundary`);
    }
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    assert.equal((byName.get("render_system_companion")?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, "ui://system-arcades-me.vercel.app/companion-v13.html");
    for (const name of ["get_current_front", "list_system_notes", "list_alters", "get_alter", "list_todos", "get_todo", "preview_erase_alter", "open_private_photo_gallery", "prepare_conversation_catch_up", "get_catch_up", "render_alter_lineup", "prepare_group_photo_render"]) assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, `${name} must be read-only`);
    assert.ok(byName.get("prepare_conversation_catch_up")?.outputSchema?.properties?.historyAccess, "conversation handoff must disclose host access");
    assert.equal(byName.has("prepare_furry_transform"), false);
    assert.equal(byName.has("prepare_furry_result_upload"), false);
    assert.equal(byName.get("set_alter_appearance")?.annotations?.idempotentHint, true, "appearance selection must be retry-safe");
    const handoff = await client.callTool({ name: "prepare_conversation_catch_up", arguments: { alterId: "11111111-1111-4111-8111-111111111111", startAt: "2026-09-03T14:00:00-05:00", endAt: "2026-09-04T10:15:00-05:00", timeZone: "America/Chicago" } });
    assert.equal((handoff.structuredContent as { elapsedSeconds: number }).elapsedSeconds, 72900);
    assert.equal((handoff.structuredContent as { historyAccess?: string }).historyAccess, "HOST_REQUIRED");
    assert.equal((handoff.structuredContent as { window?: { provenance?: string } }).window?.provenance, "USER_SELECTED");
    assert.ok(byName.get("open_private_photo_gallery")?.outputSchema?.properties?.url, "gallery fallback must return a URL");
    const gallery = await client.callTool({ name: "open_private_photo_gallery", arguments: {} });
    assert.deepEqual(gallery.structuredContent, { url: "https://bunch.example/gallery" });
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
    assert.equal((byName.get("render_alter_lineup")?._meta?.ui as { resourceUri?: string })?.resourceUri, "ui://system-arcades-me.vercel.app/alter-lineup-v3.html");
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
      csp: { connectDomains: ["https://bunch.example"], resourceDomains: ["https://bunch.example"] },
      prefersBorder: true,
    });
    assert.deepEqual(content._meta?.["openai/widgetCSP"], {
      connect_domains: ["https://bunch.example"],
      resource_domains: ["https://bunch.example"],
    });
    assert.match(html, /Bunch/);
    assert.match(html, /Catch-up tasks/);
    assert.match(html, /Mark reviewed/);
    assert.doesNotMatch(html, />Finish review</);
    assert.match(html, /set_catch_up_item_state/);
    const lineupResource = await client.readResource({ uri: "ui://system-arcades-me.vercel.app/alter-lineup-v3.html" });
    const lineupHtml = "text" in lineupResource.contents[0] ? lineupResource.contents[0].text : "";
    assert.match(lineupHtml, /isProfilePicture/);
    assert.match(lineupHtml, /HOSTING/);
    for (const version of [1, 2]) {
      const cached = await client.readResource({ uri: `ui://system-arcades-me.vercel.app/alter-lineup-v${version}.html` });
      assert.ok("text" in cached.contents[0]);
      assert.equal(cached.contents[0].text, lineupHtml);
    }
    assert.match(JSON.stringify(lineup.content), /Display is not confirmed/);
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

test("native scene MCP generation schedules once and returns only the authenticated reopen route", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const render = { id, scene: "A calm studio portrait", alterNames: [], state: "QUEUED" as const, createdAt: "2026-09-13T12:00:00.000Z", finishedAt: null, errorMessage: null, width: null, height: null, contentHash: null };
  const calls: string[] = [];
  const sceneService = {
    start: async (ownerId: string, input: unknown) => { calls.push(`start:${ownerId}:${(input as { scene: string }).scene}`); return render; },
    get: async () => render,
    list: async () => [render],
  } as unknown as Pick<NativeSceneService, "start" | "get" | "list">;
  const system = { getCurrentPresence: async () => ({ hosting: null, fronting: [], legacyCurrentFront: null }), getCurrentFront: async () => null, listAlters: async () => ({ data: [] }) } as unknown as SystemService;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("demo:native-scene", system, undefined, { listProfiles: async () => [] }, undefined, (ownerId, renderId) => calls.push(`schedule:${ownerId}:${renderId}`), sceneService);
  const client = new Client({ name: "native-scene-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const created = await client.callTool({ name: "generate_scene", arguments: { scene: render.scene, alterNames: [], requestId: "22222222-2222-4222-8222-222222222222", format: "square" } });
    assert.deepEqual(created.structuredContent, render);
    assert.deepEqual(calls, [`start:demo:native-scene:${render.scene}`, `schedule:demo:native-scene:${id}`]);
    assert.match(JSON.stringify(created.content), new RegExp(`/images\\?render=${id}`));
    assert.doesNotMatch(JSON.stringify(created), /storage_key|cap=|image:read/);
    await client.callTool({ name: "get_scene_generation", arguments: { id } });
    await client.callTool({ name: "list_scene_generations", arguments: {} });
    assert.equal(calls.filter(call => call.startsWith("schedule:")).length, 1, "read-only scene tools must not dispatch a provider job");
  } finally {
    await client.close();
    await server.close();
  }
});

test("completed native scenes reach the chat only through the scene widget", async () => {
  const priorSecret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "scene-widget-metadata-test-secret";
  const id = "33333333-3333-4333-8333-333333333333";
  const widgetUri = "ui://system-arcades-me.vercel.app/native-scene-v1.html";
  const complete = { id, scene: "Lucy Arcade in a cozy sweater", alterNames: ["Lucy Arcade"], state: "COMPLETE" as const, createdAt: "2026-09-15T12:00:00.000Z", finishedAt: "2026-09-15T12:01:30.000Z", errorMessage: null, width: 1024, height: 1024, contentHash: "a".repeat(64) };
  const sceneService = { start: async () => complete, get: async () => complete, list: async () => [complete] } as unknown as Pick<NativeSceneService, "start" | "get" | "list">;
  const system = { getCurrentPresence: async () => ({ hosting: null, fronting: [], legacyCurrentFront: null }), getCurrentFront: async () => null, listAlters: async () => ({ data: [] }) } as unknown as SystemService;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("demo:scene-widget", system, undefined, { listProfiles: async () => [] }, undefined, () => {}, sceneService);
  const client = new Client({ name: "scene-widget-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const name of ["generate_scene", "get_scene_generation"]) {
      assert.equal((byName.get(name)?._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri, widgetUri, `${name} must render the scene widget`);
      assert.equal(byName.get(name)?._meta?.["openai/outputTemplate"], widgetUri);
    }
    assert.equal(byName.get("get_scene_generation")?._meta?.["openai/widgetAccessible"], true, "the widget polls get_scene_generation");

    const read = await client.callTool({ name: "get_scene_generation", arguments: { id } });
    assert.deepEqual(read.structuredContent, complete);
    const src = (read._meta?.sceneImage as { src?: string } | undefined)?.src ?? "";
    assert.match(src, new RegExp(`^https://bunch\\.example/api/system/native-scenes/inline/${id}\\?cap=`));
    assert.doesNotMatch(JSON.stringify({ content: read.content, structuredContent: read.structuredContent }), /cap=|scene:read|native-scenes\/inline/);
    assert.match((read.content as Array<{ text: string }>)[0].text, /scene widget shows it in this chat/);

    const resource = await client.readResource({ uri: widgetUri });
    const html = "text" in resource.contents[0] ? resource.contents[0].text : "";
    assert.match(html, /get_scene_generation/);
    assert.match(html, /sceneImage/);
    assert.deepEqual(resource.contents[0]._meta?.["openai/widgetCSP"], { connect_domains: ["https://bunch.example"], resource_domains: ["https://bunch.example"] });
  } finally {
    if (priorSecret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = priorSecret;
    await client.close();
    await server.close();
  }
});

test("alter results name the generate_scene call instead of asking for an upload", async () => {
  const priorSecret = process.env.MCP_TOKEN_SIGNING_SECRET;
  process.env.MCP_TOKEN_SIGNING_SECRET = "scene-routing-metadata-test-secret";
  const lucy = { id: "44444444-4444-4444-8444-444444444444", name: "Lucy Arcade", aliases: ["Lucy"], strengths: [], boundaries: [], imageCount: 1, images: [{ id: "55555555-5555-4555-8555-555555555555", contentType: "image/png", isProfilePicture: false, createdAt: "2026-09-01T12:00:00.000Z" }], appearanceReferenceImageIds: ["55555555-5555-4555-8555-555555555555"], version: 1, createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" };
  const mouse = { ...lucy, id: "66666666-6666-4666-8666-666666666666", name: "Mouse Arcade", aliases: [], imageCount: 0, images: [], appearanceReferenceImageIds: [] };
  const system = { getAlter: async (_ownerId: string, alterId: string) => (alterId === lucy.id ? lucy : mouse), listAlters: async () => ({ data: [lucy, mouse] }) } as unknown as SystemService;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("demo:scene-routing", system, undefined, { listProfiles: async () => [] });
  const client = new Client({ name: "scene-routing-test", version: "1.0.0" });
  const text = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0].text;
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const loaded = text(await client.callTool({ name: "get_alter", arguments: { alterId: lucy.id } }));
    assert.ok(loaded.includes('call generate_scene with alterNames ["Lucy Arcade"]'), loaded);
    assert.match(loaded, /carry no pixels/);
    assert.match(loaded, /Do not ask the user to upload a photo Bunch already holds/);
    const listed = text(await client.callTool({ name: "list_alters", arguments: {} }));
    assert.ok(listed.includes('alterNames ["Lucy Arcade"]'), listed);
    assert.doesNotMatch(listed, /Mouse Arcade/);
    assert.equal(text(await client.callTool({ name: "get_alter", arguments: { alterId: mouse.id } })), "Loaded the alter record.");

    // ChatGPT called the prepare tool for Lucy, read "Use the attached appearance
    // reference", and asked the user to attach one. The route must come first.
    const { tools } = await client.listTools();
    for (const name of ["prepare_alter_image_prompt", "prepare_furry_scene"]) {
      const description = tools.find((tool) => tool.name === name)?.description ?? "";
      assert.match(description, /call generate_scene directly/, name);
      assert.doesNotMatch(description, /before drawing|If this host cannot/, name);
    }
    const prepared = await client.callTool({ name: "prepare_alter_image_prompt", arguments: { scene: "Lucy in a big cozy sweater", alters: [lucy.id] } });
    const route = text(prepared);
    assert.ok(route.startsWith('To draw Lucy Arcade in this chat, call generate_scene with alterNames ["Lucy Arcade"]'), route);
    assert.match(route, /do not ask the user to upload a photo Bunch already holds/);
    assert.match((prepared.content as Array<{ text: string }>)[1].text, /Use the attached appearance reference/, "the packet itself is unchanged for external adapters");
    assert.doesNotMatch(JSON.stringify(prepared.content), /cap=/);
    const scene = await client.callTool({ name: "prepare_furry_scene", arguments: { scene: "Lucy in a big cozy sweater", alterNames: ["Lucy"] } });
    assert.ok(text(scene).startsWith('To draw Lucy Arcade in this chat, call generate_scene with alterNames ["Lucy Arcade"]'), text(scene));
    const unready = await client.callTool({ name: "prepare_alter_image_prompt", arguments: { scene: "Portrait", alters: [mouse.id] } });
    assert.doesNotMatch(JSON.stringify(unready.content), /generate_scene/, "generate_scene would reject a person without references");
  } finally {
    if (priorSecret === undefined) delete process.env.MCP_TOKEN_SIGNING_SECRET;
    else process.env.MCP_TOKEN_SIGNING_SECRET = priorSecret;
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

test("Furry Image Studio hooks are not exposed through MCP", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer("demo:furry-transform", { listAlters: async () => ({ data: [] }) } as unknown as SystemService, undefined, { listProfiles: async () => [] });
  const client = new Client({ name: "furry-transform-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    const names = new Set(tools.map((tool) => tool.name));
    assert.equal(names.has("prepare_furry_transform"), false);
    assert.equal(names.has("prepare_furry_result_upload"), false);
  } finally {
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
