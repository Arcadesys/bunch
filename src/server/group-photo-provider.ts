import sharp from "sharp";

export type RenderImageInput = { bytes: Uint8Array; contentType: string; name: string };
export type RenderProviderInput = { prompt: string; model: string; images: RenderImageInput[]; size: string };
export type GroupPhotoProvider = (input: RenderProviderInput) => Promise<Uint8Array>;
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
  const payload = await response.json() as { data?: { b64_json?: string }[] };
  const encoded = payload.data?.[0]?.b64_json;
  if (!encoded || encoded.length > 28_000_000) throw new Error("The image provider did not return a usable photo.");
  return new Uint8Array(Buffer.from(encoded, "base64"));
};

export async function normalizeFinishedPhoto(bytes: Uint8Array) {
  // Decode rather than trusting a content-type or a success JSON response.
  const { data, info } = await sharp(bytes, { limitInputPixels: 36_000_000 }).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
  if (info.width < 256 || info.height < 256 || data.byteLength > 5 * 1024 * 1024) throw new Error("The image provider did not return a usable photo.");
  return { bytes: data, width: info.width, height: info.height, contentType: "image/jpeg" };
}
