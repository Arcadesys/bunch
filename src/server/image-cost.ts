export const IMAGE_RATE_CARD_VERSION = "openai-2026-09-08";
export const IMAGE_SOFT_LIMIT_MICROUSD = 100_000;
export const IMAGE_HARD_LIMIT_MICROUSD = 250_000;

export type ImageAction = "generation" | "repair" | "photo_finish";
export type ImageQuality = "low" | "medium" | "high";
export type ImageSpendMode = "STANDARD" | "ECONOMY" | "PAUSED";
export type ImageRoute = "LEGACY" | "PROMPT_ONLY" | "IDENTITY" | "ECONOMY";
export type ImageRoutingStage = "off" | "shadow" | "operator" | "pilot";

export type ProviderUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_text_tokens?: number;
  input_image_tokens?: number;
  output_text_tokens?: number;
  output_image_tokens?: number;
};

export type ImagePlan = {
  action: ImageAction;
  route: ImageRoute;
  mode: ImageSpendMode;
  model: string;
  quality: ImageQuality;
  size: string;
  referenceCount: number;
  projectedCostMicrousd: number;
  rateCardVersion: string;
};

const SUNBURST = "gpt-image-2.5-sunburst";
const ECONOMY = "gpt-image-2";

export function imageRoutingStage(value = process.env.AI_COST_ROUTING_STAGE): ImageRoutingStage {
  return value === "off" || value === "operator" || value === "pilot" ? value : "shadow";
}

export function spendMode(spendMicrousd: number, enabled: boolean): ImageSpendMode {
  if (!enabled) return "STANDARD";
  if (spendMicrousd >= IMAGE_HARD_LIMIT_MICROUSD) return "PAUSED";
  if (spendMicrousd >= IMAGE_SOFT_LIMIT_MICROUSD) return "ECONOMY";
  return "STANDARD";
}

export function routingEnabledFor(role: string, stage = imageRoutingStage()) {
  return stage === "pilot" || (stage === "operator" && role === "OPERATOR");
}

export function budgetModeFor(spendMicrousd: number, stage = imageRoutingStage(), role = "FRIEND"): ImageSpendMode {
  if (stage === "shadow") return "STANDARD";
  if (stage === "off") return spendMicrousd >= IMAGE_HARD_LIMIT_MICROUSD ? "PAUSED" : "STANDARD";
  if (stage === "operator" && role !== "OPERATOR") return "STANDARD";
  return spendMode(spendMicrousd, true);
}

export function planImage(input: {
  action: ImageAction;
  size: string;
  referenceCount: number;
  spendMicrousd: number;
  role: string;
  legacyModel?: string;
  stage?: ImageRoutingStage;
}): ImagePlan {
  const stage = input.stage ?? imageRoutingStage();
  const enabled = routingEnabledFor(input.role, stage);
  const mode = budgetModeFor(input.spendMicrousd, stage, input.role);
  const identitySensitive = input.action !== "generation" || input.referenceCount > 0;
  let route: ImageRoute;
  let model: string;
  let quality: ImageQuality;
  if (!enabled) {
    route = "LEGACY";
    model = input.legacyModel || SUNBURST;
    quality = "high";
  } else if (mode === "ECONOMY" || mode === "PAUSED") {
    route = "ECONOMY";
    model = ECONOMY;
    quality = "low";
  } else if (identitySensitive) {
    route = "IDENTITY";
    model = SUNBURST;
    quality = "high";
  } else {
    route = "PROMPT_ONLY";
    model = ECONOMY;
    quality = "medium";
  }
  return {
    action: input.action,
    route,
    mode,
    model,
    quality,
    size: input.size,
    referenceCount: input.referenceCount,
    projectedCostMicrousd: projectedImageCostMicrousd(model, quality, input.size, input.referenceCount),
    rateCardVersion: IMAGE_RATE_CARD_VERSION,
  };
}

export function projectedImageCostMicrousd(model: string, quality: ImageQuality, size: string, references: number) {
  const square = size === "1024x1024";
  let output = 250_000;
  if (model === ECONOMY) {
    const table = {
      low: square ? 6_000 : 5_000,
      medium: square ? 53_000 : 41_000,
      high: square ? 211_000 : 165_000,
    };
    output = table[quality];
  } else if (quality === "low") output = square ? 12_000 : 10_000;
  else if (quality === "medium") output = square ? 106_000 : 82_000;
  // Reference input varies with source dimensions. This conservative reservation
  // is replaced by the provider's modality-specific usage after the call.
  const inputPerReference = model === ECONOMY ? 16_000 : 32_000;
  return output + references * inputPerReference + 5_000;
}

export function sanitizeProviderUsage(value: unknown): ProviderUsage {
  if (!value || typeof value !== "object") return {};
  const usage = value as Record<string, unknown>;
  const input = usage.input_tokens_details as Record<string, unknown> | undefined;
  const output = usage.output_tokens_details as Record<string, unknown> | undefined;
  const number = (candidate: unknown) => typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0 ? candidate : undefined;
  return Object.fromEntries(Object.entries({
    input_tokens: number(usage.input_tokens),
    output_tokens: number(usage.output_tokens),
    total_tokens: number(usage.total_tokens),
    input_text_tokens: number(input?.text_tokens),
    input_image_tokens: number(input?.image_tokens),
    output_text_tokens: number(output?.text_tokens),
    output_image_tokens: number(output?.image_tokens),
  }).filter((entry): entry is [string, number] => entry[1] !== undefined));
}

export function actualImageCostMicrousd(model: string, usage: ProviderUsage) {
  const textInput = usage.input_text_tokens;
  const imageInput = usage.input_image_tokens;
  const imageOutput = usage.output_image_tokens ?? usage.output_tokens;
  if (textInput === undefined || imageInput === undefined || imageOutput === undefined) return null;
  const rates = model === ECONOMY
    ? { textInput: 2.5, imageInput: 4, imageOutput: 15 }
    : { textInput: 5, imageInput: 8, imageOutput: 30 };
  return Math.round(textInput * rates.textInput + imageInput * rates.imageInput + imageOutput * rates.imageOutput);
}

export function microUsdToUsd(value: number) {
  return Number((value / 1_000_000).toFixed(6));
}
