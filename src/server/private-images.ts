import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";

const uploadDirectory = join(process.cwd(), "private-uploads");
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 5 * 1024 * 1024;

export type StoredPrivateImage = { storageKey: string; contentType: string };

function validateImage(file: File) {
  if (!allowedTypes.has(file.type)) throw new Error("Use a JPEG, PNG, or WebP image.");
  if (file.size > maxBytes) throw new Error("Images must be 5 MB or smaller.");
}

export async function savePrivateImage(ownerId: string, file: File): Promise<StoredPrivateImage> {
  validateImage(file);
  if (process.env.SYSTEM_DEMO_MODE === "true") return saveLocalPrivateImage(file);
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL) throw new Error("Private Blob storage is not configured.");
  const ownerSegment = createHash("sha256").update(ownerId).digest("hex").slice(0, 24);
  const safeName = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const blob = await put(`profiles/${ownerSegment}/${randomUUID()}-${safeName}`, file, {
    access: "private",
    addRandomSuffix: true,
    contentType: file.type,
    cacheControlMaxAge: 0,
  });
  return { storageKey: blob.pathname, contentType: blob.contentType };
}

async function saveLocalPrivateImage(file: File): Promise<StoredPrivateImage> {
  validateImage(file);
  await mkdir(uploadDirectory, { recursive: true });
  const storageKey = `${randomUUID()}-${basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await writeFile(join(uploadDirectory, storageKey), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  return { storageKey, contentType: file.type };
}

export async function readPrivateImage(storageKey: string): Promise<{ body: BodyInit; contentType: string; etag?: string }> {
  if (process.env.SYSTEM_DEMO_MODE === "true") {
    if (basename(storageKey) !== storageKey) throw new Error("Invalid image key.");
    return { body: await readFile(join(uploadDirectory, storageKey)), contentType: "application/octet-stream" };
  }
  const result = await get(storageKey, { access: "private" });
  if (!result || result.statusCode !== 200 || !result.stream || !result.blob.contentType) throw new Error("Image not found.");
  return { body: result.stream as unknown as BodyInit, contentType: result.blob.contentType, etag: result.blob.etag };
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
  await del(storageKeys);
}
