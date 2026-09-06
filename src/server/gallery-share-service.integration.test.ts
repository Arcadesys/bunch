import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { GalleryShareService } from "./gallery-share-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

integration("shared galleries are live, owner-isolated, and stop at expiry or revocation", async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const service = new GalleryShareService(pool);
  const ownerA = `test:gallery-a:${randomUUID()}`;
  const ownerB = `test:gallery-b:${randomUUID()}`;
  const alterA = randomUUID();
  const alterB = randomUUID();
  const imageA = randomUUID();
  const imageB = randomUUID();

  try {
    for (const owner of [ownerA, ownerB]) {
      await pool.query("insert into app_user(id, google_subject) values($1,$1)", [owner]);
    }
    await pool.query("insert into pilot_account(owner_id,role,state) values($1,'OPERATOR','ACTIVE')", [ownerA]);
    await pool.query("insert into alter_profile(id,owner_id,name,archived_at) values($1,$2,'Retained A',now()),($3,$4,'Only B',null)", [alterA, ownerA, alterB, ownerB]);
    await pool.query("insert into private_image(id,owner_id,alter_id,storage_key,content_type,is_profile_picture) values($1,$2,$3,$4,'image/png',true),($5,$6,$7,$8,'image/png',true)", [imageA, ownerA, alterA, `profiles/test/${imageA}`, imageB, ownerB, alterB, `profiles/test/${imageB}`]);

    const created = await service.create(ownerA, "1h");
    const gallery = await service.publicGallery(created.token);
    assert.deepEqual(gallery?.alters, [{ id: alterA, name: "Retained A", images: [{ id: imageA, contentType: "image/png", role: "profile", order: 0 }] }]);
    assert.equal(await service.publicImage(created.token, imageB), null, "a share cannot resolve another owner's image");

    const freshImage = randomUUID();
    await pool.query("insert into private_image(id,owner_id,alter_id,storage_key,content_type) values($1,$2,$3,$4,'image/webp')", [freshImage, ownerA, alterA, `profiles/test/${freshImage}`]);
    assert.equal((await service.publicGallery(created.token))?.alters[0].images.length, 2, "new uploads appear without regenerating a link");

    await pool.query("update gallery_share set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where id=$1", [created.share.id]);
    assert.equal(await service.publicGallery(created.token), null);
    assert.equal(await service.publicImage(created.token, imageA), null);

    const forever = await service.create(ownerA, "forever");
    assert.equal(forever.share.expiresAt, null);
    assert.equal(await service.revoke(ownerA, forever.share.id), true);
    assert.equal(await service.publicGallery(forever.token), null);
  } finally {
    await pool.query("delete from pilot_account where owner_id=any($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.query("delete from app_user where id=any($1::text[])", [[ownerA, ownerB]]).catch(() => undefined);
    await pool.end();
  }
});
