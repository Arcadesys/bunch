import assert from "node:assert/strict";
import test from "node:test";
import { GalleryShareService } from "./gallery-share-service";

test("gallery shares store only a hash and build a narrow retained gallery", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const pool = { query: async (text: string, values?: unknown[]) => {
    calls.push({ text, values });
    if (text.startsWith("insert into gallery_share")) return { rows: [{ id: "a", expires_at: values?.[2], revoked_at: null, created_at: "2026-01-01T00:00:00Z" }], rowCount: 1 };
    if (text.includes("select s.owner_id")) return { rows: [{ owner_id: "owner-a" }], rowCount: 1 };
    if (text.includes("from alter_profile")) return { rows: [
      { alter_id: "first", name: "Same name", id: "image-1", content_type: "image/png", is_profile_picture: true },
      { alter_id: "second", name: "Same name", id: "image-2", content_type: "image/webp", is_profile_picture: false },
    ], rowCount: 2 };
    if (text.includes("alter_id is null")) return { rows: [{ id: "general-1", content_type: "image/jpeg" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }};
  const service = new GalleryShareService(pool as never);
  const created = await service.create("owner-a", "1h");
  assert.match(created.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.ok(created.share.expiresAt);
  assert.ok(!calls[0].values?.includes(created.token));
  assert.match(String(calls[0].values?.[1]), /^[a-f0-9]{64}$/);

  const gallery = await service.publicGallery(created.token);
  assert.deepEqual(gallery, {
    alters: [
      { id: "first", name: "Same name", images: [{ id: "image-1", contentType: "image/png", role: "profile", order: 0 }] },
      { id: "second", name: "Same name", images: [{ id: "image-2", contentType: "image/webp", role: "image", order: 0 }] },
    ],
    generalImages: [{ id: "general-1", contentType: "image/jpeg", role: "image", order: 0 }],
  });
  assert.ok(calls.some((call) => call.text.includes("a.state='ACTIVE'")));
});
