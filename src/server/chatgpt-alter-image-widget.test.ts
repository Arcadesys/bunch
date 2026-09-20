import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { chatgptAlterImageWidget } from "@/server/chatgpt-alter-image-widget";

type HarnessOptions = { uploadFile?: (file: unknown, options: unknown) => Promise<{ fileId: string }> };

function harness(options: HarnessOptions = {}) {
  const html = chatgptAlterImageWidget();
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) {
      const node: any = { id, hidden: false, textContent: "", dataset: {}, querySelector: () => ({ textContent: "" }) };
      node.querySelector = () => node.icon || (node.icon = { textContent: "" });
      elements.set(id, node);
    }
    return elements.get(id);
  };
  const listeners = new Map<string, (event: any) => void>();
  const parent = { postMessage: () => undefined };
  const openai: any = {
    toolOutput: null,
    widgetState: {},
    uploadFile: options.uploadFile,
    setWidgetState: async (state: unknown) => { openai.widgetState = state; },
    sendFollowUpMessage: async () => undefined,
  };
  const context = vm.createContext({
    window: { openai, parent, addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn) },
    parent,
    document: { getElementById: element },
    fetch: async () => ({ ok: true, headers: { get: () => "image/png" }, blob: async () => ({ size: 100 }) }),
    File: class { constructor(public parts: unknown[], public name: string, public options: unknown) {} },
    Set, Promise, Error,
  });
  vm.runInContext(script, context);
  return { html, openai, element, listeners, context };
}

function sendToolResult(h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) {
  h.listeners.get("message")?.({ source: h.context.window.parent, data: { method: "ui/notifications/tool-result", params: {
    scene: "Colette playing this piano", alterNames: ["Colette"], sceneImage: { file_id: "scene-file" },
    ...overrides, _meta: { referenceMedia: [{ alterName: "Colette", contentType: "image/png", src: "https://system.example/private?cap=secret" }] },
  } } });
}

test("widget includes the approved visible copy, accessibility hooks, and no private capability", () => {
  const html = chatgptAlterImageWidget();
  assert.match(html, /Preparing references/);
  assert.match(html, /Piano image received/);
  assert.match(html, /Private appearance references ready/);
  assert.match(html, /Generating securely in ChatGPT/);
  assert.match(html, /Reference images are shared only for this generation/);
  assert.match(html, /Your generated image will appear here/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /private\?cap=|appearance-reference|Colette/);
});

test("widget uploads references after the scene, sets safe ordering, then follows up once", async () => {
  const uploaded: string[] = [];
  const states: unknown[] = [];
  let followUps = 0;
  const h = harness({ uploadFile: async (file: any) => { uploaded.push(file.name); return { fileId: "reference-file" }; } });
  h.openai.setWidgetState = async (state: unknown) => { states.push(state); h.openai.widgetState = state; };
  h.openai.sendFollowUpMessage = async () => { followUps += 1; };
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(uploaded, ["reference-1.png"]);
  assert.equal(followUps, 1);
  assert.deepEqual((states[0] as any).imageIds, ["scene-file", "reference-file"]);
  assert.match((states[0] as any).modelContent, /image 1 as the scene/);
  assert.deepEqual((states[0] as any).privateContent, { phase: "sent" });
  assert.match(h.element("generation-status-detail").textContent, /Generating securely/);
  assert.equal(states.length, 1);
});

test("widget fails visibly when APIs or reference transfer are unavailable", async () => {
  const h = harness();
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.element("generation-status-detail").textContent, /unavailable|could not/i);
  assert.match(h.element("output-title").textContent, /could not start/i);
});

test("widget does not repeat a completed handoff on remount", async () => {
  let followUps = 0;
  const h = harness({ uploadFile: async () => ({ fileId: "reference-file" }) });
  h.openai.sendFollowUpMessage = async () => { followUps += 1; };
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followUps, 1);
});
