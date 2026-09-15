import assert from "node:assert/strict";
import test from "node:test";
import { lineupWidget } from "@/server/lineup-widget";

test("alter lineup widget emits valid standalone browser JavaScript", () => {
  const html = lineupWidget("https://system-arcades-me.vercel.app");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script, "widget script must be present");
  assert.doesNotThrow(() => new Function(script));
  assert.match(html, /Profile picture for/);
  assert.match(html, /No selected profile picture/);
});

import vm from "node:vm";

function harness(openai?: Record<string, unknown>) {
  const elements = new Map<string, { innerHTML: string; textContent: string }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "" });
    return elements.get(id)!;
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const sent: Array<{ method: string; id?: string }> = [];
  const timers = new Map<number, () => void>();
  const parent = { postMessage: (message: { method: string }) => sent.push(message) };
  const context = vm.createContext({
    document: { getElementById: element },
    window: { parent, openai, addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler) },
    setTimeout: (callback: () => void) => { timers.set(1, callback); return 1; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  vm.runInContext(lineupWidget("https://example.com").match(/<script>([\s\S]*)<\/script>/)![1], context);
  return {
    element, sent,
    message: (data: unknown, source: unknown = parent) => listeners.get("message")!({ data, source }),
    globals: (globals: unknown) => listeners.get("openai:set_globals")!({ detail: { globals } }),
    expire: () => { for (const callback of timers.values()) callback(); },
  };
}

const profiles = [{ id: "example", name: "Example Profile", imageCount: 1 }];
const metadata = { privateImages: [{ alterId: "example", isProfilePicture: true, src: "https://example.com/test-picture.png" }] };

test("lineup initializes before host data and renders private picture metadata", () => {
  const h = harness();
  assert.equal(h.sent[0].method, "ui/initialize");
  h.message({ jsonrpc: "2.0", id: h.sent[0].id, result: { protocolVersion: "2026-01-26" } });
  assert.equal(h.sent[1].method, "ui/notifications/initialized");
  h.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { profiles }, _meta: metadata } });
  assert.match(h.element("lineup").innerHTML, /test-picture.png/);
  assert.match(h.element("lineup").innerHTML, /Example Profile/);
  h.expire();
  assert.match(h.element("notice").textContent, /1 active profile/);
});

test("lineup accepts initial and delayed compatibility globals including later metadata", () => {
  const initial = harness({ toolOutput: { profiles }, toolResponseMetadata: metadata });
  assert.match(initial.element("lineup").innerHTML, /test-picture.png/);
  const delayed = harness();
  delayed.globals({ toolOutput: { profiles } });
  assert.match(delayed.element("lineup").innerHTML, /Example Profile/);
  delayed.globals({ toolResponseMetadata: metadata });
  assert.match(delayed.element("lineup").innerHTML, /test-picture.png/);
});

test("missing, malformed, cancelled, and failed data do not masquerade as an empty lineup", () => {
  for (const params of [{}, { isError: true }, { structuredContent: { profiles: null } }]) {
    const h = harness();
    h.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params });
    assert.match(h.element("notice").textContent, /could not load/);
    assert.doesNotMatch(h.element("notice").textContent, /No active/);
  }
  const h = harness();
  h.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { profiles } } }, {});
  assert.equal(h.element("lineup").innerHTML, "");
  h.expire();
  assert.match(h.element("notice").textContent, /Manage profiles/);
  h.message({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { structuredContent: { profiles: [] } } });
  assert.equal(h.element("notice").textContent, "No active profiles found.");
  h.message({ jsonrpc: "2.0", method: "ui/notifications/tool-cancelled" });
  assert.match(h.element("notice").textContent, /could not load/);
});
