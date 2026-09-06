import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { canShareGallery } from "./gallery-access";
import { GalleryShareService } from "./gallery-share-service";
import { PilotService } from "./pilot-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("legacy gallery owner retains identity without enrollment; all pilot gates and isolation apply", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `gallery_access_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  const galleries = new GalleryShareService(pool), pilot = new PilotService(pool);
  const owner = "auth0:legacy-fixture", other = "auth0:other-fixture", stranger = "auth0:unknown-fixture";
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter(f => f.endsWith(".sql")).sort())
      await pool.query(await readFile(`drizzle/${file}`, "utf8"));
    await pool.query("insert into app_user(id,google_subject) values($1,$1),($2,$2)", [owner,other]);
    const alter = randomUUID(), foreign = randomUUID();
    await pool.query("insert into alter_profile(id,owner_id,name) values($1,$2,'Legacy profile'),($3,$4,'Other profile')", [alter,owner,foreign,other]);
    await pilot.assertAccess(owner);
    assert.equal(await pilot.account(owner), null);
    assert.equal(await canShareGallery(pool, owner), true);
    assert.equal(await canShareGallery(pool, stranger), false);
    await assert.rejects(galleries.create(stranger,"1h"), /unavailable/);
    const link = await galleries.create(owner,"forever");
    assert.equal((await galleries.publicGallery(link.token))?.alters[0].id, alter);
    assert.equal((await galleries.publicGallery(link.token))?.alters.length, 1);
    assert.equal(await pilot.account(owner), null, "sharing never enrolls the existing owner");
    assert.equal((await galleries.list(other)).length, 0);
    assert.equal(await galleries.revoke(other,link.share.id), false);
    const listed = await galleries.list(owner);
    assert.equal("token" in listed[0], false);
    assert.equal("url" in listed[0], false);

    await pool.query("update pilot_policy set gate_enabled=true where id");
    assert.equal(await canShareGallery(pool, owner), false);
    assert.equal(await galleries.publicGallery(link.token), null);
    await assert.rejects(galleries.create(owner,"1h"), /unavailable/);
    await assert.rejects(galleries.list(owner), /unavailable/);
    await pool.query("insert into pilot_account(owner_id,role,state) values($1,'FRIEND','ACTIVE')", [owner]);
    assert.equal(await canShareGallery(pool, owner), false, "paused friends stay blocked");
    assert.equal(await galleries.publicGallery(link.token), null);
    await pool.query("update pilot_policy set friends_enabled=true where id");
    assert.equal(await canShareGallery(pool, owner), true);
    assert.equal((await galleries.publicGallery(link.token))?.alters[0].id, alter);
    for (const state of ["REVOKED","DELETING","DELETED"]) {
      await pool.query("update pilot_account set state=$1 where owner_id=$2", [state,owner]);
      assert.equal(await canShareGallery(pool, owner), false);
      assert.equal(await galleries.publicGallery(link.token), null);
      await assert.rejects(galleries.create(owner,"1h"), /unavailable/);
    }
    await pool.query("update pilot_account set state='ACTIVE',role='OPERATOR' where owner_id=$1", [owner]);
    await pool.query("update pilot_policy set friends_enabled=false where id");
    assert.equal(await canShareGallery(pool, owner), true);
    assert.equal(await galleries.revoke(owner,link.share.id), true);
    assert.equal(await galleries.publicGallery(link.token), null);
    await pool.query("delete from pilot_policy");
    assert.equal(await canShareGallery(pool, owner), false, "missing policy fails closed");
  } finally {
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
  }
});
