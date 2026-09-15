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

integration("fronting is opt-in per stable link, explicit, overlapping, minimal and owner-isolated", async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const service = new GalleryShareService(pool);
  const owner = `test:front-share:${randomUUID()}`, other = `test:front-other:${randomUUID()}`;
  const first = randomUUID(), second = randomUUID(), host = randomUUID(), foreign = randomUUID();
  try {
    for (const id of [owner, other]) {
      await pool.query("insert into app_user(id,google_subject) values($1,$1)", [id]);
      if (id === owner) await pool.query("insert into pilot_account(owner_id,role,state) values($1,'OPERATOR','ACTIVE')", [id]);
    }
    for (const [id, who, name] of [[first,owner,"One"],[second,owner,"Two"],[host,owner,"Host only"],[foreign,other,"Private other owner"]])
      await pool.query("insert into alter_profile(id,owner_id,name,communication_guidance) values($1,$2,$3,'Private guidance')", [id,who,name]);
    for (const [id, who, kind] of [[first,owner,"FRONTING"],[second,owner,"FRONTING"],[host,owner,"HOSTING"],[foreign,other,"FRONTING"]])
      await pool.query("insert into presence_period(owner_id,alter_id,kind) values($1,$2,$3)", [who,id,kind]);
    const link = await service.create(owner,"forever"), untouched = await service.create(owner,"forever");
    assert.equal(link.share.showCurrentFronting, false);
    assert.equal((await service.publicGallery(link.token))?.currentFronting, undefined);
    await assert.rejects(service.setCurrentFronting(other, link.share.id, true), /not found/);
    assert.equal((await service.setCurrentFronting(owner,link.share.id,true)).showCurrentFronting, true);
    const fronting = (await service.publicGallery(link.token))!.currentFronting!;
    assert.deepEqual(new Set(fronting.people.map(p => p.name)), new Set(["One","Two"]));
    assert.deepEqual(Object.keys(fronting).sort(), ["checkedAt","people"]);
    assert.deepEqual(Object.keys(fronting.people[0]).sort(), ["id","name"]);
    assert.equal((await service.publicGallery(untouched.token))?.currentFronting, undefined);
    assert.equal((await service.list(owner)).find(s => s.id === link.share.id)?.showCurrentFronting, true);
    await pool.query("update presence_period set ended_at=now() where owner_id=$1 and alter_id=$2", [owner,first]);
    assert.deepEqual((await service.publicGallery(link.token))?.currentFronting?.people, [{id:second,name:"Two"}]);
    await pool.query("update presence_period set ended_at=now() where owner_id=$1 and kind='FRONTING'", [owner]);
    assert.deepEqual((await service.publicGallery(link.token))?.currentFronting?.people, []);
    await service.setCurrentFronting(owner,link.share.id,false);
    assert.equal((await service.publicGallery(link.token))?.currentFronting, undefined);
    await service.setCurrentFronting(owner,link.share.id,true);
    await pool.query("update pilot_account set state='REVOKED' where owner_id=$1", [owner]);
    assert.equal(await service.publicGallery(link.token), null);
    await assert.rejects(service.setCurrentFronting(owner,link.share.id,false), /unavailable/);
    await pool.query("update pilot_account set state='ACTIVE' where owner_id=$1", [owner]);
    await service.revoke(owner,link.share.id);
    assert.equal(await service.publicGallery(link.token), null);
    await assert.rejects(service.setCurrentFronting(owner,link.share.id,true), /not found/);
    await pool.query("update gallery_share set created_at=now()-interval '2 hours', expires_at=now()-interval '1 hour' where id=$1", [untouched.share.id]);
    await assert.rejects(service.setCurrentFronting(owner,untouched.share.id,true), /not found/);
  } finally {
    await pool.query("delete from pilot_account where owner_id=any($1::text[])", [[owner,other]]);
    await pool.query("delete from app_user where id=any($1::text[])", [[owner,other]]);
    await pool.end();
  }
});
