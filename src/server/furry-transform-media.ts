import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const allowedTypes = new Map([["image/jpeg", ".jpg"], ["image/png", ".png"], ["image/webp", ".webp"]]);
const maxBytes = 5 * 1024 * 1024;

export type AuthorizedReferenceMedia = { role: "character_reference"; src: string; contentType: "image/jpeg" | "image/png" | "image/webp" };
export type MaterializedReferenceMedia = { paths: string[]; cleanup(): Promise<void> };

// This consumes metadata obtained programmatically from DIDdy. Callers must
// never serialize its src values into a prompt, a command line, or a log.
export async function materializeAuthorizedReferenceMedia(media: AuthorizedReferenceMedia[], publicOrigin: string, fetchImpl: typeof fetch = fetch): Promise<MaterializedReferenceMedia> {
  if (!media.length || media.length > 12) throw new Error("Choose one to twelve appearance references.");
  const origin = new URL(publicOrigin).origin;
  const directory = await mkdtemp(join(tmpdir(), "diddy-furry-"));
  await chmod(directory, 0o700);
  try {
    const paths: string[] = [];
    for (const item of media) {
      const url = new URL(item.src);
      const localTestOrigin = process.env.NODE_ENV === "test" && url.protocol === "http:" && url.hostname === "127.0.0.1";
      if ((url.protocol !== "https:" && !localTestOrigin) || url.origin !== origin || !url.pathname.startsWith("/api/system/images/inline/") || !url.searchParams.has("cap")) throw new Error("Reference media must be an authorized DIDdy image URL.");
      const extension = allowedTypes.get(item.contentType);
      if (!extension) throw new Error("Unsupported reference image type.");
      const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0] !== item.contentType) throw new Error("Reference image could not be read.");
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > maxBytes) throw new Error("Reference image is too large.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new Error("Reference image is too large.");
      const path = join(directory, `${randomUUID()}${extension}`);
      await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
      paths.push(path);
    }
    return { paths, cleanup: async () => { await rm(directory, { recursive: true, force: true }); } };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
