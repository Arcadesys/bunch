import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { chatgptAlterImageWidget } from "@/server/chatgpt-alter-image-widget";

type HarnessOptions = { uploadFile?: (file: unknown, options: unknown) => Promise<{ fileId: string }> };

function harness(options: HarnessOptions = {}) {
  const html = chatgptAlterImageWidget("https://system.example");
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
    Set, Promise, Error, URL,
  });
  vm.runInContext(script, context);
  return { html, openai, element, listeners, context };
}

function sendToolResult(h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) {
  h.listeners.get("message")?.({ source: h.context.window.parent, data: { method: "ui/notifications/tool-result", params: {
    structuredContent: { scene: "Colette playing this piano", identities: [{ alterName: "Colette", referenceCount: 1 }] },
    _meta: { sceneImage: { file_id: "scene-file" }, referenceMedia: [{ alterName: "Colette", contentType: "image/png", src: "https://system.example/api/system/images/inline/reference?cap=secret" }] }, ...overrides,
  } } });
}

test("widget includes the approved visible copy, accessibility hooks, and no private capability", () => {
  const html = chatgptAlterImageWidget("https://system.example");
  assert.match(html, /Preparing references/);
  assert.match(html, /Scene image \(optional\)/);
  assert.match(html, /Private appearance references/);
  assert.match(html, /ChatGPT image handoff/);
  assert.match(html, /use the private references only for this request/);
  assert.match(html, /Reference images are shared only for this generation/);
  assert.match(html, /The generated image will appear in the conversation/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(html, /private\?cap=|appearance-reference|Colette/);
});

test("widget uploads references after the scene, sets safe ordering, then follows up once", async () => {
  const uploaded: string[] = [];
  const uploadOptions: unknown[] = [];
  const states: unknown[] = [];
  let followUps = 0;
  let followUpPrompt = "";
  const h = harness({ uploadFile: async (file: any, options: unknown) => { uploaded.push(file.name); uploadOptions.push(options); return { fileId: "reference-file" }; } });
  h.openai.setWidgetState = async (state: unknown) => { states.push(state); h.openai.widgetState = state; };
  h.openai.sendFollowUpMessage = async ({ prompt }: { prompt: string }) => { followUps += 1; followUpPrompt = prompt; };
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(uploaded, ["reference-1.png"]);
  assert.equal(followUps, 1);
  assert.deepEqual(Array.from((states[states.length - 1] as any).imageIds), ["scene-file", "reference-file"]);
  assert.equal(JSON.stringify(uploadOptions), JSON.stringify([{ library: false }]));
  assert.match((states[states.length - 1] as any).modelContent, /image 1 as the scene/);
  assert.match(followUpPrompt, /Do not call Bunch again/);
  assert.equal((states[states.length - 1] as any).privateContent.phase, "sent");
  assert.match(h.element("generation-status-detail").textContent, /request was sent/);
  assert.equal(states.length, 3);
});

test("widget uploads references from image 1 when no scene image exists", async () => {
  const states: any[] = [];
  let followUps = 0;
  let followUpPrompt = "";
  const h = harness({ uploadFile: async () => ({ fileId: "reference-file" }) });
  h.openai.setWidgetState = async (state: unknown) => { states.push(state); h.openai.widgetState = state; };
  h.openai.sendFollowUpMessage = async ({ prompt }: { prompt: string }) => { followUps += 1; followUpPrompt = prompt; };
  h.listeners.get("message")?.({ source: h.context.window.parent, data: { method: "ui/notifications/tool-result", params: {
    structuredContent: { scene: "Colette in the garden", identities: [{ alterName: "Colette", referenceCount: 1 }] },
    _meta: { referenceMedia: [{ alterName: "Colette", contentType: "image/png", src: "https://system.example/api/system/images/inline/reference?cap=secret" }] },
  } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followUps, 1);
  assert.deepEqual(Array.from(states[states.length - 1].imageIds), ["reference-file"]);
  assert.match(states[states.length - 1].modelContent, /image 1 is for Colette/);
  assert.doesNotMatch(states[states.length - 1].modelContent, /scene image/);
  assert.match(followUpPrompt, /uploaded images are private appearance references/);
});

test("widget preserves multiple ordered references for one alter", async () => {
  const states: any[] = [];
  let upload = 0;
  const h = harness({ uploadFile: async () => ({ fileId: `reference-${++upload}` }) });
  h.openai.setWidgetState = async (state: unknown) => { states.push(state); h.openai.widgetState = state; };
  h.listeners.get("message")?.({ source: h.context.window.parent, data: { method: "ui/notifications/tool-result", params: {
    structuredContent: { scene: "Colette playing this piano", identities: [{ alterName: "Colette", referenceCount: 2 }] },
    _meta: { sceneImage: { file_id: "scene-file" }, referenceMedia: [
      { alterName: "Colette", contentType: "image/png", src: "https://system.example/api/system/images/inline/one?cap=first" },
      { alterName: "Colette", contentType: "image/png", src: "https://system.example/api/system/images/inline/two?cap=second" },
    ] },
  } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(Array.from(states[states.length - 1].imageIds), ["scene-file", "reference-1", "reference-2"]);
  assert.match(states[states.length - 1].modelContent, /image 2 is for Colette; image 3 is for Colette/);
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

test("legacy sent state is ambiguous and never repeats automatically", async () => {
  let uploads = 0, followUps = 0;
  const h = harness({uploadFile: async () => { uploads++; return {fileId:"reference-file"}; }});
  h.openai.widgetState = {phase:"sent", imageIds:["scene-file", "reference-file"], privateContent:{phase:"sent"}};
  h.openai.sendFollowUpMessage = async () => { followUps++; };
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads, 0);
  assert.equal(followUps, 0);
  assert.match(h.element("generation-status-detail").textContent, /did not confirm whether generation started/);
  assert.match(h.element("output-detail").textContent, /Earlier reference transfer and generation status are unknown/);
});

test("duplicate notifications while upload is pending send only one handoff", async () => {
  let release!: () => void;
  let uploads = 0, followUps = 0;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const h = harness({ uploadFile: async () => { uploads++; await blocked; return {fileId: "reference-file"}; } });
  h.openai.sendFollowUpMessage = async () => { followUps++; };
  sendToolResult(h);
  sendToolResult(h);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads, 1);
  assert.equal(followUps, 1);
});

test("failed follow-up stays retryable without uploading references again", async () => {
  let uploads = 0, followUps = 0;
  const h = harness({ uploadFile: async () => { uploads++; return {fileId: "reference-file"}; } });
  h.openai.sendFollowUpMessage = async () => { followUps++; if (followUps === 1) throw new Error("Host unavailable"); };
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.openai.widgetState.privateContent.phase, "failed");
  assert.match(h.element("output-detail").textContent, /already been transferred/);
  assert.equal(h.element("retry").hidden, false);
  sendToolResult(h); // A duplicate notification must not retry a failed request.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(followUps, 1);
  h.element("retry").onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads, 1);
  assert.equal(followUps, 2);
  assert.equal(h.openai.widgetState.privateContent.phase, "sent");
  assert.equal(h.element("retry").hidden, true);
});

test("a host without the follow-up API does not transfer any references", async () => {
  let uploads = 0;
  const h = harness({ uploadFile: async () => { uploads++; return {fileId:"reference-file"}; } });
  delete h.openai.sendFollowUpMessage;
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads, 0);
  assert.match(h.element("generation-status-detail").textContent, /Codex saved-reference workflow/);
  assert.match(h.element("output-detail").textContent, /No appearance references were transferred/);
});

test("widget unwraps private metadata from canonical ChatGPT envelopes", async () => {
  for (const key of ["call_tool_result", "mcp_tool_result"]) {
    let uploads = 0;
    const h = harness({ uploadFile: async () => { uploads++; return {fileId:"reference-file"}; } });
    sendToolResult(h, {_meta: {[key]: {_meta: {referenceMedia:[{alterName:"Colette", contentType:"image/png", src:"https://system.example/api/system/images/inline/ref?cap=secret"}]}}}});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(uploads, 1, key);
    assert.equal(h.openai.widgetState.privateContent.phase, "sent");
  }
});

test("a new request on the same widget is not suppressed by an earlier handoff", async () => {
  let uploads = 0, followUps = 0;
  const h = harness({ uploadFile: async () => { uploads++; return {fileId:"reference-file"}; } });
  h.openai.sendFollowUpMessage = async () => { followUps++; };
  sendToolResult(h);
  await new Promise(resolve => setImmediate(resolve));
  sendToolResult(h, {structuredContent:{scene:"Colette at a new project",identities:[{alterName:"Colette",referenceCount:1}]}});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(uploads, 2);
  assert.equal(followUps, 2);
});
