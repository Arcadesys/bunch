import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageAllowanceNotice } from "./image-allowance";

test("image allowance names economy routing and dollar limits without relying on colour", () => {
  const html = renderToStaticMarkup(<ImageAllowanceNotice value={{
    limit: 10,
    used: 2,
    reserved: 1,
    remaining: 7,
    resetsAt: "2026-09-20T05:00:00.000Z",
    spendTodayUsd: 0.12,
    softLimitUsd: 0.1,
    hardLimitUsd: 0.25,
    mode: "ECONOMY",
    routingStage: "pilot",
    nextPlannedRoutes: {
      promptOnly: { model: "gpt-image-2", quality: "low", label: "Economy mode" },
      identitySensitive: { model: "gpt-image-2", quality: "low", label: "Economy mode" },
    },
  }} />);

  assert.match(html, /7 of 10 image uses remaining/);
  assert.match(html, /<strong>Economy mode<\/strong>/);
  assert.match(html, /Soft limit \$0\.10; hard limit \$0\.25/);
  assert.match(html, /Prompt-only: gpt-image-2, low/);
  assert.match(html, /Identity-sensitive: gpt-image-2, low/);
});
