import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { SystemService } from "./system-service";
const integration=process.env.TEST_DATABASE_URL?test:test.skip;
integration("reviewed switch is atomic, owner isolated and bound to its retry payload",async()=>{
  const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const service=new SystemService(pool,async()=>{}), owner=`fixture:${randomUUID()}`, other=`fixture:${randomUUID()}`;
  try {
    const a=(await service.createAlter(owner,{requestId:randomUUID(),name:"A"},"WEB")).data;
    const b=(await service.createAlter(owner,{requestId:randomUUID(),name:"B"},"WEB")).data;
    const foreign=(await service.createAlter(other,{requestId:randomUUID(),name:"C"},"WEB")).data;
    const first=(await service.startFrontingEpisode(owner,{requestId:randomUUID(),alterId:a.id},"WEB")).data;
    const reviewed=[{id:first.id,version:first.version}];
    await assert.rejects(()=>service.recordNativeSwitch(owner,{requestId:randomUUID(),reviewed,end:[],start:[foreign.id]},"SYSTEM"));
    const request={requestId:randomUUID(),reviewed,end:[],start:[b.id]};
    const added=await service.recordNativeSwitch(owner,request,"SYSTEM"); assert.equal(added.data.started.length,1);
    assert.equal((await service.recordNativeSwitch(owner,request,"SYSTEM")).replayed,true);
    assert.equal((await service.resolveNativeSwitch(owner,request)).outcome,"recorded");
    const cancelled={requestId:randomUUID(),reviewed,end:[],start:[a.id]};
    assert.equal((await service.resolveNativeSwitch(owner,cancelled)).outcome,"cancelled");
    await assert.rejects(()=>service.recordNativeSwitch(owner,cancelled,"SYSTEM"));
    assert.equal((await service.resolveNativeSwitch(owner,cancelled)).outcome,"cancelled");
    await assert.rejects(()=>service.resolveNativeSwitch(owner,{...cancelled,start:[b.id]}));
    await assert.rejects(()=>service.recordNativeSwitch(owner,{...request,start:[a.id]},"SYSTEM"));
    await assert.rejects(()=>service.recordNativeSwitch(owner,{requestId:randomUUID(),reviewed,end:[reviewed[0]],start:[]},"SYSTEM"));
    const current=(await service.getCurrentPresence(owner)).fronting; assert.equal(current.length,2);
    const exact=current.map(x=>({id:x.id,version:x.version}));
    const ended=await service.recordNativeSwitch(owner,{requestId:randomUUID(),reviewed:exact,end:[exact.find(x=>x.id===first.id)!],start:[]},"SYSTEM");
    assert.equal(ended.data.ended.length,1); assert.equal((await service.getCurrentPresence(owner)).fronting[0].alterId,b.id);
    await service.switchCurrentFront(owner,{requestId:randomUUID(),alterId:a.id,expectedCurrentVersion:null},"WEB");
    const latest=(await service.getCurrentPresence(owner)).fronting.map(x=>({id:x.id,version:x.version}));
    await assert.rejects(()=>service.recordNativeSwitch(owner,{requestId:randomUUID(),reviewed:latest,end:latest,start:[]},"SYSTEM"));
    assert.equal((await service.getCurrentPresence(owner)).fronting.length,1);
    const simultaneousOwner=`fixture:${randomUUID()}`;
    try {
      const member=(await service.createAlter(simultaneousOwner,{requestId:randomUUID(),name:"Concurrent"},"WEB")).data;
      const operations=Promise.allSettled([service.recordNativeSwitch(simultaneousOwner,{requestId:randomUUID(),reviewed:[],end:[],start:[member.id]},"SYSTEM"),service.switchCurrentFront(simultaneousOwner,{requestId:randomUUID(),alterId:member.id,expectedCurrentVersion:null},"WEB")]);
      const result=await Promise.race([operations,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("Concurrent switch deadlocked")),5000))]);
      assert.equal(result.length,2);
    } finally {await pool.query("delete from app_user where id=$1",[simultaneousOwner]);}
  } finally {await pool.query("delete from app_user where id=any($1::text[])",[[owner,other]]);await pool.end();}
});
