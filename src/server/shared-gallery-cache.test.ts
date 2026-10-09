import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteSharedGalleryCache,
  deleteSharedGalleryImageCache,
  matchesSharedGalleryEtag,
  matchesSharedGalleryLastModified,
  sharedGalleryCacheTag,
  sharedGalleryImageCacheTag,
  sharedGallerySourceImageCacheTag,
  sharedGalleryImageEtag,
  sharedGalleryImageHeaders,
} from "./shared-gallery-cache";

test("shared gallery image cache identity is scoped without exposing the bearer token", () => {
  const shareId = "share-123";
  const imageId = "image-456";
  const token = "secret-token-value";
  const shareTag = sharedGalleryCacheTag(shareId);
  const imageTag = sharedGalleryImageCacheTag(shareId, imageId);
  const etag = sharedGalleryImageEtag("shared-gallery:token:digest:image:image-456", "blob-etag");

  assert.equal(shareTag, "shared-gallery:share:share-123");
  assert.equal(imageTag, "shared-gallery:share:share-123:image:image-456");
  assert.equal(sharedGallerySourceImageCacheTag(imageId), "shared-gallery:image:image-456");
  assert.ok(!shareTag.includes(token));
  assert.ok(!imageTag.includes(token));
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  assert.notEqual(etag, sharedGalleryImageEtag("shared-gallery:token:other:image:image-456", "blob-etag"));
});

test("image deletion foreground-deletes every shared representation by source tag", async () => {
  const calls: string[] = [];
  const result = await deleteSharedGalleryImageCache("image-456", {
    deleteByTag: async (tag) => { calls.push(`delete:${tag}`); },
    invalidateByTag: async (tag) => { calls.push(`invalidate:${tag}`); },
  });
  assert.deepEqual(result, { deleted: true, fallback: false });
  assert.deepEqual(calls, ["delete:shared-gallery:image:image-456"]);
});

test("disabled edge caching bypasses production purge operations", async () => {
  const previousFlag = process.env.SHARED_IMAGE_EDGE_CACHE;
  const previousVercel = process.env.VERCEL;
  delete process.env.SHARED_IMAGE_EDGE_CACHE;
  process.env.VERCEL = "1";
  try {
    assert.deepEqual(await deleteSharedGalleryCache("share-123"), {
      deleted: true,
      fallback: false,
      bypassed: true,
    });
    assert.deepEqual(await deleteSharedGalleryImageCache("image-456"), {
      deleted: true,
      fallback: false,
      bypassed: true,
    });
  } finally {
    if (previousFlag === undefined) delete process.env.SHARED_IMAGE_EDGE_CACHE;
    else process.env.SHARED_IMAGE_EDGE_CACHE = previousFlag;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  }
});

test("successful image headers revalidate browsers and default to no shared cache", () => {
  const lastModified = new Date("2026-09-21T12:00:00.000Z");
  const headers = sharedGalleryImageHeaders('"etag"', lastModified);
  assert.equal(headers["Cache-Control"], "public, max-age=0, must-revalidate");
  assert.equal(headers["Vercel-CDN-Cache-Control"], "no-store");
  assert.equal(headers.ETag, '"etag"');
  assert.equal(headers["Last-Modified"], "Mon, 21 Sep 2026 12:00:00 GMT");
});

test("successful tagged image headers can retain only at Vercel for 30 seconds", () => {
  const lastModified = new Date("2026-09-21T12:00:00.000Z");
  const headers = sharedGalleryImageHeaders('"etag"', lastModified, true);
  assert.equal(headers["Cache-Control"], "public, max-age=0, must-revalidate");
  assert.equal(headers["Vercel-CDN-Cache-Control"], "public, max-age=30");
  assert.equal(headers.ETag, '"etag"');
  assert.equal(headers["Last-Modified"], "Mon, 21 Sep 2026 12:00:00 GMT");
});

test("conditional requests match strong or weak ETags and HTTP dates", () => {
  const etag = '"etag"';
  const lastModified = new Date("2026-09-21T12:00:00.000Z");
  assert.equal(matchesSharedGalleryEtag(etag, etag), true);
  assert.equal(matchesSharedGalleryEtag(`W/${etag}`, etag), true);
  assert.equal(matchesSharedGalleryEtag('"other"', etag), false);
  assert.equal(matchesSharedGalleryLastModified("Mon, 21 Sep 2026 12:00:00 GMT", lastModified), true);
  assert.equal(matchesSharedGalleryLastModified("Mon, 21 Sep 2026 11:59:59 GMT", lastModified), false);
});

test("share cache deletion is foreground-first with narrow invalidation fallback", async () => {
  const calls: string[] = [];
  const result = await deleteSharedGalleryCache("share-123", {
    deleteByTag: async (tag) => { calls.push(`delete:${tag}`); throw new Error("purge unavailable"); },
    invalidateByTag: async (tag) => { calls.push(`invalidate:${tag}`); },
  });
  assert.deepEqual(result, { deleted: false, fallback: true });
  assert.deepEqual(calls, ["delete:shared-gallery:share:share-123", "invalidate:shared-gallery:share:share-123"]);
});
