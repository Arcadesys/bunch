import { createHash } from "node:crypto";
import { addCacheTag, dangerouslyDeleteByTag, invalidateByTag } from "@vercel/functions";

const cacheNamespace = "shared-gallery";

/**
 * Cache tags intentionally contain database identifiers only. They must never
 * contain the bearer token, since Vercel exposes tags to cache tooling.
 */
export function sharedGalleryCacheTag(shareId: string) {
  return `${cacheNamespace}:share:${shareId}`;
}

export function sharedGalleryImageCacheTag(shareId: string, imageId: string) {
  return `${sharedGalleryCacheTag(shareId)}:image:${imageId}`;
}

export function sharedGallerySourceImageCacheTag(imageId: string) {
  return `${cacheNamespace}:image:${imageId}`;
}

/** A deterministic fallback identity for old/mocked service responses. */
export function sharedGalleryTokenCacheIdentity(token: string, imageId: string) {
  const tokenDigest = createHash("sha256").update(token).digest("hex");
  return `${cacheNamespace}:token:${tokenDigest}:image:${imageId}`;
}

export function sharedGalleryImageEtag(identity: string, sourceEtag?: string) {
  const source = sourceEtag?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? "unknown";
  return `"${createHash("sha256").update(`${identity}:${source}`).digest("hex")}"`;
}

export function sharedGalleryEdgeCacheRequested() {
  return process.env.SHARED_IMAGE_EDGE_CACHE === "true";
}

export function sharedGalleryImageHeaders(etag: string, lastModified: Date, edgeCacheEnabled = false) {
  return {
    // Browsers must revalidate. Vercel retention is opt-in and only enabled
    // after cache tags were successfully attached to this response.
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Vercel-CDN-Cache-Control": edgeCacheEnabled ? "public, max-age=30" : "no-store",
    ETag: etag,
    "Last-Modified": lastModified.toUTCString(),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

export function matchesSharedGalleryEtag(ifNoneMatch: string | null, etag: string) {
  if (!ifNoneMatch) return false;
  return ifNoneMatch.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized.replace(/^W\//, "") === etag;
  });
}

export function matchesSharedGalleryLastModified(ifModifiedSince: string | null, lastModified: Date) {
  if (!ifModifiedSince) return false;
  const since = Date.parse(ifModifiedSince);
  return Number.isFinite(since) && Math.floor(lastModified.getTime() / 1000) <= Math.floor(since / 1000);
}

/**
 * Attach both a share-wide and image-specific tag to a successful response.
 * Local/test invocations have no Vercel request context, where addCacheTag is
 * intentionally a no-op. A tag failure must never turn an authorized image
 * into an error response.
 */
export async function addSharedGalleryImageCacheTags(shareId: string, imageId: string) {
  try {
    await addCacheTag([sharedGalleryCacheTag(shareId), sharedGalleryImageCacheTag(shareId, imageId), sharedGallerySourceImageCacheTag(imageId)]);
    return true;
  } catch (error) {
    console.error("[gallery-share] cache tag attachment failed", { error: error instanceof Error ? error.message : "unknown" });
    return false;
  }
}

/**
 * Revoke paths use foreground deletion so a revoked share cannot remain in a
 * Vercel cache. If the delete API is temporarily unavailable, invalidate the
 * same narrow tag as a safe fallback; authorization still rejects the share.
 */
type SharedGalleryPurgeOperations = {
  deleteByTag: typeof dangerouslyDeleteByTag;
  invalidateByTag: typeof invalidateByTag;
};

export async function deleteSharedGalleryCache(shareId: string, operations?: SharedGalleryPurgeOperations) {
  // There is no shared response cache to purge until the rollout flag is on,
  // or outside Vercel. Injected operations still exercise revocation in tests.
  if (!operations && (!sharedGalleryEdgeCacheRequested() || !process.env.VERCEL)) {
    return { deleted: true, fallback: false, bypassed: true } as const;
  }
  const activeOperations = operations ?? { deleteByTag: dangerouslyDeleteByTag, invalidateByTag };
  const tag = sharedGalleryCacheTag(shareId);
  try {
    await activeOperations.deleteByTag(tag);
    return { deleted: true, fallback: false } as const;
  } catch (error) {
    try {
      await activeOperations.invalidateByTag(tag);
      console.error("[gallery-share] foreground cache delete failed; invalidated instead", { error: error instanceof Error ? error.message : "unknown" });
      return { deleted: false, fallback: true } as const;
    } catch (fallbackError) {
      console.error("[gallery-share] cache purge failed after revocation", { error: fallbackError instanceof Error ? fallbackError.message : "unknown" });
      return { deleted: false, fallback: false } as const;
    }
  }
}

export async function deleteSharedGalleryImageCache(imageId: string, operations?: SharedGalleryPurgeOperations) {
  if (!operations && (!sharedGalleryEdgeCacheRequested() || !process.env.VERCEL)) {
    return { deleted: true, fallback: false, bypassed: true } as const;
  }
  const activeOperations = operations ?? { deleteByTag: dangerouslyDeleteByTag, invalidateByTag };
  const tag = sharedGallerySourceImageCacheTag(imageId);
  try {
    await activeOperations.deleteByTag(tag);
    return { deleted: true, fallback: false } as const;
  } catch (error) {
    try {
      await activeOperations.invalidateByTag(tag);
      console.error("[gallery-share] image cache delete failed; invalidated instead", { error: error instanceof Error ? error.message : "unknown" });
      return { deleted: false, fallback: true } as const;
    } catch (fallbackError) {
      console.error("[gallery-share] image cache purge failed after deletion", { error: fallbackError instanceof Error ? fallbackError.message : "unknown" });
      return { deleted: false, fallback: false } as const;
    }
  }
}
