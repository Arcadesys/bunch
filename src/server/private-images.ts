// Image bytes never enter model-visible output. Production stores the file in private
// blob storage and keeps only its opaque pathname, which an owner-authorized route
// streams back; demo mode writes to private-uploads/ instead so a local run needs no
// cloud account.

import { getPilotService } from "./pilot-service";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";

const uploadDirectory = join(process.cwd(), "private-uploads");
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 5 * 1024 * 1024;
const downloadTimeoutMs = 15_000;
export const PRIVATE_MEDIA_MAX_AGE = 60 * 60 * 24 * 30;

export type StoredPrivateImage = { storageKey: string; contentType: string };
export type OpenAIFileInput = { download_url: string; file_id: string; mime_type?: string; file_name?: string };
export type PrivateImageRead = {
  body: BodyInit;
  contentType: string;
  etag?: string;
  lastModified?: Date;
  notModified?: boolean;
};

function validateImage(file: File) {
  if (!allowedTypes.has(file.type)) throw new Error("Use a JPEG, PNG, or WebP image.");
  if (file.size > maxBytes) throw new Error("Images must be 5 MB or smaller.");
}

function contentTypeFromHeader(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || undefined;
}

/** Read ChatGPT's temporary file URL server-side; never return its URL or bytes through MCP. */
export async function downloadOpenAIImage(input: OpenAIFileInput): Promise<File> {
  let url: URL;
  try { url = new URL(input.download_url); } catch { throw new Error("The selected ChatGPT file has an invalid download URL."); }
  if (url.protocol !== "https:") throw new Error("The selected ChatGPT file must use a secure download URL.");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(downloadTimeoutMs) });
  if (!response.ok || !response.body) throw new Error("The selected ChatGPT file could not be downloaded.");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("Images must be 5 MB or smaller.");
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("Images must be 5 MB or smaller.");
      chunks.push(new Uint8Array(next.value).slice().buffer);
    }
  } finally { reader.releaseLock(); }
  const headerType = contentTypeFromHeader(response.headers.get("content-type"));
  const contentType = (headerType && allowedTypes.has(headerType) ? headerType : input.mime_type?.toLowerCase());
  if (!contentType) throw new Error("The selected ChatGPT file has no image type.");
  return new File(chunks, input.file_name || "chatgpt-image", { type: contentType });
}

export async function savePrivateImage(ownerId: string, file: File): Promise<StoredPrivateImage> {
  validateImage(file);
  if (process.env.SYSTEM_DEMO_MODE === "true") return saveLocalPrivateImage(file);
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL) throw new Error("Private Blob storage is not configured.");
  const ownerSegment = createHash("sha256").update(ownerId).digest("hex").slice(0, 24);
  const safeName = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `profiles/${ownerSegment}/${randomUUID()}-${safeName}`;
  const pilot = getPilotService();
  await pilot.reserveUpload(ownerId, key, file.size);
  try {
    const blob = await put(key, file, { access: "private", addRandomSuffix: false, contentType: file.type, cacheControlMaxAge: PRIVATE_MEDIA_MAX_AGE });
    await pilot.pool.query("update pilot_upload set state='STORED' where storage_key=$1", [key]);
    // Deletion/revocation may have occurred during transfer. Never attach after it.
    await pilot.assertAccess(ownerId);
    return { storageKey: blob.pathname, contentType: blob.contentType };
  } catch(error) {
    // Preserve the reservation if cleanup fails so deletion/reconciliation can retry.
    await del([key]);
    await pilot.pool.query("delete from pilot_upload where storage_key=$1", [key]);
    throw error;
  }
}

async function saveLocalPrivateImage(file: File): Promise<StoredPrivateImage> {
  validateImage(file);
  await mkdir(uploadDirectory, { recursive: true });
  const storageKey = `${randomUUID()}-${basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await writeFile(join(uploadDirectory, storageKey), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  return { storageKey, contentType: file.type };
}

export async function readPrivateImage(storageKey: string, options: { ifNoneMatch?: string } = {}): Promise<PrivateImageRead> {
  if (process.env.SYSTEM_DEMO_MODE === "true") {
    if (basename(storageKey) !== storageKey) throw new Error("Invalid image key.");
    const path = join(uploadDirectory, storageKey);
    const [body, metadata] = await Promise.all([readFile(path), stat(path)]);
    const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
    return { body, contentType: "application/octet-stream", etag, lastModified: metadata.mtime };
  }
  const result = await get(storageKey, { access: "private", ...(options.ifNoneMatch ? { ifNoneMatch: options.ifNoneMatch } : {}) });
  if (!result) throw new Error("Image not found.");
  if (result.statusCode === 304) return { body: new Uint8Array(), contentType: "", etag: result.blob.etag, lastModified: result.blob.uploadedAt, notModified: true };
  if (!result.stream || !result.blob.contentType) throw new Error("Image not found.");
  return { body: result.stream as unknown as BodyInit, contentType: result.blob.contentType, etag: result.blob.etag, lastModified: result.blob.uploadedAt };
}

export async function deletePrivateImages(storageKeys: string[]) {
  if (!storageKeys.length) return;
  if (process.env.SYSTEM_DEMO_MODE === "true") {
    for (const storageKey of storageKeys) {
      if (basename(storageKey) !== storageKey) throw new Error("Invalid image key.");
      try { await unlink(join(uploadDirectory, storageKey)); } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    return;
  }
  if (!storageKeys.length) return;
  await del(storageKeys);
  await getPilotService().pool.query("delete from pilot_upload where storage_key=any($1::text[])", [storageKeys]);
}
