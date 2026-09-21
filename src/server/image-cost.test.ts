import assert from "node:assert/strict";
import test from "node:test";
import { actualImageCostMicrousd, budgetModeFor, planImage, sanitizeProviderUsage, spendMode } from "./image-cost";

test("image routing preserves identity quality and lowers prompt-only cost", () => {
  const promptOnly = planImage({ action: "generation", size: "1024x1024", referenceCount: 0, spendMicrousd: 0, role: "FRIEND", stage: "pilot" });
  assert.deepEqual({ model: promptOnly.model, quality: promptOnly.quality, route: promptOnly.route }, { model: "gpt-image-2", quality: "medium", route: "PROMPT_ONLY" });
  const identity = planImage({ action: "generation", size: "1024x1024", referenceCount: 2, spendMicrousd: 0, role: "FRIEND", stage: "pilot" });
  assert.deepEqual({ model: identity.model, quality: identity.quality, route: identity.route }, { model: "gpt-image-2.5-sunburst", quality: "high", route: "IDENTITY" });
  const economy = planImage({ action: "repair", size: "1536x1024", referenceCount: 1, spendMicrousd: 100_000, role: "FRIEND", stage: "pilot" });
  assert.deepEqual({ model: economy.model, quality: economy.quality, mode: economy.mode }, { model: "gpt-image-2", quality: "low", mode: "ECONOMY" });
  assert.equal(spendMode(250_000, true), "PAUSED");
  assert.equal(planImage({ action: "generation", size: "1024x1024", referenceCount: 0, spendMicrousd: 250_000, role: "FRIEND", stage: "pilot" }).mode, "PAUSED");
});

test("shadow and rollback stages retain the configured high-quality route", () => {
  const shadow = planImage({ action: "generation", size: "1024x1024", referenceCount: 0, spendMicrousd: 999_000, role: "FRIEND", stage: "shadow", legacyModel: "configured-model" });
  assert.deepEqual({ model: shadow.model, quality: shadow.quality, mode: shadow.mode, route: shadow.route }, { model: "configured-model", quality: "high", mode: "STANDARD", route: "LEGACY" });
  const rollback = planImage({ action: "generation", size: "1024x1024", referenceCount: 0, spendMicrousd: 100_000, role: "FRIEND", stage: "off", legacyModel: "configured-model" });
  assert.deepEqual({ model: rollback.model, quality: rollback.quality, mode: rollback.mode, route: rollback.route }, { model: "configured-model", quality: "high", mode: "STANDARD", route: "LEGACY" });
  assert.equal(budgetModeFor(250_000, "off"), "PAUSED");
  assert.equal(budgetModeFor(250_000, "operator", "FRIEND"), "STANDARD");
  assert.equal(budgetModeFor(250_000, "operator", "OPERATOR"), "PAUSED");
  assert.equal(planImage({ action: "generation", size: "1024x1024", referenceCount: 0, spendMicrousd: 250_000, role: "FRIEND", stage: "off" }).mode, "PAUSED");
});

test("provider usage retains modality detail and produces versioned microdollar cost", () => {
  const usage = sanitizeProviderUsage({ input_tokens: 30, output_tokens: 40, total_tokens: 70, input_tokens_details: { text_tokens: 10, image_tokens: 20 }, output_tokens_details: { image_tokens: 40, text_tokens: 0 }, ignored: "private" });
  assert.deepEqual(usage, { input_tokens: 30, output_tokens: 40, total_tokens: 70, input_text_tokens: 10, input_image_tokens: 20, output_text_tokens: 0, output_image_tokens: 40 });
  assert.equal(actualImageCostMicrousd("gpt-image-2.5-sunburst", usage), 1_410);
  assert.equal(actualImageCostMicrousd("gpt-image-2", usage), 705);
  assert.equal(actualImageCostMicrousd("gpt-image-2", { output_tokens: 40 }), null);
});
