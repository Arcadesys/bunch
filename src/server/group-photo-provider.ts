import sharp from "sharp";

export type RenderImageInput = { bytes: Uint8Array; contentType: string; name: string };
type UsageCallback = { onUsage?: (usage: Record<string, number>) => Promise<void> };
export type RenderProviderInput = UsageCallback & { prompt: string; model: string; images: RenderImageInput[]; size: string };
export type GroupPhotoProvider = (input: RenderProviderInput) => Promise<Uint8Array>;
export type NativeSceneProviderInput = UsageCallback & { prompt: string; model: string; references: RenderImageInput[]; size: string };
export type NativeSceneProvider = (input: NativeSceneProviderInput) => Promise<Uint8Array>;
export const DEFAULT_GROUP_PHOTO_MODEL = "gpt-image-2.5-sunburst";
export const MAX_REFERENCE_IMAGES = 15; // One additional input is the scene.

export function photoFinisherAvailable() { return Boolean(process.env.OPENAI_API_KEY?.trim()); }

/** No reference URLs, private storage keys or credentials enter logs or responses. */
export const openAIGroupPhotoProvider: GroupPhotoProvider = async input => {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Photo finishing is not configured yet.");
  const form = new FormData();
  form.set("model", input.model);
  form.set("prompt", input.prompt);
  form.set("size", input.size);
  form.set("quality", "high");
  form.set("output_format", "jpeg");
  for (const image of input.images) form.append("image[]", new Blob([new Uint8Array(image.bytes)], { type: image.contentType }), image.name);
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
    signal: AbortSignal.timeout(210_000),
  });
  if (!response.ok) throw new Error("The image provider could not finish this photo. Your scene is saved. Try again later.");
  const payload = await response.json() as { data?: { b64_json?: string }[]; usage?: unknown };
  if (input.onUsage && payload.usage) await input.onUsage(safeUsage(payload.usage)).catch(() => { /* Usage telemetry must not lose a generated image. */ });
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded || encoded.length > 28_000_000) throw new Error("The image provider did not return a usable photo.");
  return new Uint8Array(Buffer.from(encoded, "base64"));
};

/** Prompt-only requests use generations; references use the private image-edit path. */
export const openAINativeSceneProvider: NativeSceneProvider = async input => {
  if (input.references.length) return openAIGroupPhotoProvider({ prompt: input.prompt, model: input.model, images: input.references, size: input.size, onUsage: input.onUsage });
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Native scene generation is not configured yet.");
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: input.model, prompt: input.prompt, size: input.size, quality: "high", output_format: "jpeg" }), signal: AbortSignal.timeout(210_000),
  });
  if (!response.ok) throw new Error("The image provider could not generate this scene. Your request was not saved as an image.");
  const payload = await response.json() as { data?: { b64_json?: string }[]; usage?: unknown };
  if (input.onUsage && payload.usage) await input.onUsage(safeUsage(payload.usage)).catch(() => { /* Usage telemetry must not lose a generated image. */ });
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded || encoded.length > 28_000_000) throw new Error("The image provider did not return a usable scene.");
  return new Uint8Array(Buffer.from(encoded, "base64"));
};

export async function normalizeFinishedPhoto(bytes: Uint8Array) {
  // Decode rather than trusting a content-type or a success JSON response.
  const { data, info } = await sharp(bytes, { limitInputPixels: 36_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  if (info.width < 256 || info.height < 256 || data.byteLength > 5 * 1024 * 1024) throw new Error("The image provider did not return a usable photo.");
  return { bytes: data, width: info.width, height: info.height, contentType: "image/jpeg" };
}

function safeUsage(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const usage = value as Record<string, unknown>;
  return Object.fromEntries(["input_tokens", "output_tokens", "total_tokens"].flatMap(key => typeof usage[key] === "number" && Number.isFinite(usage[key]) ? [[key, usage[key] as number]] : []));
}
