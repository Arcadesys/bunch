import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { SystemService } from "./system-service";
import { selectedAvatar } from "./native-roster-avatar";
const integration=process.env.TEST_DATABASE_URL?test:test.skip;
integration("selected avatar is owner-bound, current, and active",async()=>{
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const service=new SystemService(pool,async()=>{});
  const owner=`fixture:${randomUUID()}`,other=`fixture:${randomUUID()}`;
  try {
    const a=(await service.createAlter(owner,{requestId:randomUUID(),name:"Fictional A"},"WEB")).data;
    const b=(await service.createAlter(other,{requestId:randomUUID(),name:"Fictional B"},"WEB")).data;
    const selected=randomUUID(),unselected=randomUUID(),foreign=randomUUID();
    await pool.query(`insert into private_image(id,owner_id,alter_id,storage_key,content_type,is_profile_picture) values ($1,$2,$3,$4,'image/png',true),($5,$2,$3,$6,'image/png',false),($7,$8,$9,$10,'image/png',true)`,[selected,owner,a.id,`fixture-${selected}`,unselected,`fixture-${unselected}`,foreign,other,b.id,`fixture-${foreign}`]);
    assert.equal((await selectedAvatar(pool,owner,a.id))?.storage_key,`fixture-${selected}`);
    assert.equal(await selectedAvatar(pool,owner,b.id),null);
    assert.equal(await selectedAvatar(pool,other,a.id),null);
    await service.archiveAlter(owner,a.id,{requestId:randomUUID(),expectedVersion:a.version},"WEB");
    assert.equal(await selectedAvatar(pool,owner,a.id),null);
  } finally {await pool.query("delete from app_user where id=any($1::text[])",[[owner,other]]);await pool.end();}
});
