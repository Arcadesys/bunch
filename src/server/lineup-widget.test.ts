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
