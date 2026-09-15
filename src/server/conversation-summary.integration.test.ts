import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ConversationSummaryService } from "./conversation-summary-service";
import { SystemService } from "./system-service";
import { PilotService } from "./pilot-service";
import { createMcpServer } from "./mcp-server";
import { GET } from "@/app/api/cron/expire-catch-ups/route";

// The MCP server has no default origin, so every test that builds one must say
// where this instance is served from. Pinned rather than defaulted: these
// assertions must not change with whatever origin the shell happens to export.
process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch.example";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration("30-day catch-up retention through authenticated owner-scoped MCP services", async t => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `summary_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  const summaries = new ConversationSummaryService(pool), pilot = new PilotService(pool), system = new SystemService(pool,async()=>{});
  const a = `auth0:${randomUUID()}`, b = `auth0:${randomUUID()}`;
  try {
    await pool.query(await readFile("db/baseline.sql","utf8"));
    for (const file of (await readdir("drizzle")).filter(f=>f.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${file}`,"utf8"));
    const alterA = (await system.createAlter(a,{requestId:randomUUID(),name:"Synthetic A"},"WEB")).data;
    const alterB = (await system.createAlter(b,{requestId:randomUUID(),name:"Synthetic B"},"WEB")).data;
    await pool.query("insert into pilot_account (owner_id,role,state) values ($1,'FRIEND','ACTIVE'),($2,'FRIEND','ACTIVE')",[a,b]);
    await pool.query("update pilot_policy set friends_enabled=true where id");
    const input = { requestId:randomUUID(),alterId:alterA.id,startAt:"2026-07-01T00:00:00Z",endAt:"2026-09-01T00:00:00Z",timeZone:"America/Chicago",summary:"A synthetic decision was made. One task remains open.",coverage:"Only supplied fixture messages; other conversations were unavailable." };
    await t.test("production saves fail closed until retention cleanup is configured", async()=> {
      const oldNode = process.env.NODE_ENV, oldSecret = process.env.CRON_SECRET;
      try {
        Object.assign(process.env, { NODE_ENV: "production" }); delete process.env.CRON_SECRET;
        await assert.rejects(summaries.save(a,input), /retention is not configured/);
      } finally {
        if(oldNode===undefined) delete (process.env as Record<string,string|undefined>).NODE_ENV; else Object.assign(process.env,{NODE_ENV:oldNode});
        if(oldSecret===undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=oldSecret;
      }
    });
    let saved: Awaited<ReturnType<typeof summaries.save>>;
    await t.test("save and retrieve via MCP; server sets exactly 720 hours", async()=> {
      const server = createMcpServer(a,system,undefined,undefined,summaries);
      const client = new Client({name:"summary-eval",version:"1"});
      const [ct,st] = InMemoryTransport.createLinkedPair();
      await server.connect(st); await client.connect(ct);
      try {
        const result = await client.callTool({name:"save_conversation_catch_up",arguments:input});
        assert.equal(result.isError,undefined,JSON.stringify(result));
        saved = result.structuredContent as typeof saved;
        const retrieved = await client.callTool({name:"get_conversation_catch_up",arguments:{id:saved.id}});
        assert.equal((retrieved.structuredContent as { summary: string }).summary,input.summary);
        const row = await summaries.get(a,saved.id);
        assert.equal(Date.parse(row.expiresAt)-Date.parse(row.createdAt),30*86400000);
        assert.equal(row.coverage,input.coverage);
      } finally { await client.close(); await server.close(); }
    });
    await t.test("isolation, forged alter IDs and invalid windows cannot leak or save",async()=> {
      await assert.rejects(summaries.get(b,saved.id),/NOT_FOUND/);
      assert.deepEqual(await summaries.list(b),[]);
      await summaries.remove(b,saved.id);
      assert.equal((await summaries.get(a,saved.id)).summary,input.summary);
      await assert.rejects(summaries.save(a,{...input,requestId:randomUUID(),alterId:alterB.id}),/NOT_FOUND/);
      await assert.rejects(summaries.save(a,{...input,startAt:input.endAt,endAt:input.startAt}));
      await assert.rejects(summaries.save(a,{...input,summary:"x".repeat(20001)}));
      assert.equal((await pilot.export(b)).data.conversation_summary.length,0);
    });
    await t.test("concurrent retries keep one row, expiry and metadata-only receipt",async()=> {
      const results = await Promise.all(Array.from({length:8},()=>summaries.save(a,input)));
      assert.ok(results.every(r=>r.id===saved.id && r.expiresAt===saved.expiresAt && r.replayed));
      assert.equal((await summaries.list(a)).length,1);
      const receipt = (await pool.query("select result from mutation_receipt where owner_id=$1 and request_id=$2",[a,input.requestId])).rows[0].result;
      assert.deepEqual(Object.keys(receipt).sort(),["expiresAt","id"]);
      assert.equal((await pilot.export(a)).data.conversation_summary.length,1);
    });
    await t.test("exact expiration is hidden from read and export before cleanup",async()=> {
      await pool.query("update conversation_summary set created_at=now()-interval '720 hours',expires_at=now() where id=$1",[saved.id]);
      await assert.rejects(summaries.get(a,saved.id),/expired/);
      assert.deepEqual(await summaries.list(a),[]);
      assert.equal((await pilot.export(a)).data.conversation_summary.length,0);
      assert.equal((await pool.query("select count(*)::int as count from conversation_summary")).rows[0].count,1);
    });
    await t.test("revocation denies access and writes but does not prevent expiry purge",async()=> {
      await pool.query("update pilot_account set state='REVOKED' where owner_id=$1",[a]);
      await assert.rejects(summaries.list(a),/FORBIDDEN/);
      await assert.rejects(summaries.save(a,{...input,requestId:randomUUID()}),/FORBIDDEN/);
      await assert.rejects(pool.query("insert into conversation_summary (owner_id,alter_id,start_at,end_at,time_zone,summary,coverage) values ($1,$2,now(),now(),'UTC','no','no')",[a,alterA.id]),/unavailable/);
      assert.equal(await summaries.purgeExpired(),1);
      assert.equal(await summaries.purgeExpired(),0);
      await pool.query("update pilot_account set state='ACTIVE' where owner_id=$1",[a]);
      assert.equal((await summaries.save(a,input)).id,saved.id);
      assert.deepEqual(await summaries.list(a),[]);
    });
    await t.test("explicit deletion cannot be undone by retry; account deletion removes remaining summaries",async()=> {
      const secondInput = {...input,requestId:randomUUID()};
      const second = await summaries.save(a,secondInput);
      await summaries.remove(a,second.id);
      await summaries.save(a,secondInput);
      await assert.rejects(summaries.get(a,second.id),/NOT_FOUND/);
      await summaries.save(a,{...input,requestId:randomUUID()});
      await pilot.beginDeletion(a);
      await assert.rejects(summaries.list(a),/FORBIDDEN/);
      await pilot.finishDeletion(a,async()=>{});
      assert.equal((await pool.query("select count(*)::int as count from conversation_summary where owner_id=$1",[a])).rows[0].count,0);
    });
  } finally { await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end(); }
});

test("retention cron rejects missing configuration and incorrect credentials before database access",async()=> {
  const old = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    assert.equal((await GET(new Request("https://example.test/api/cron/expire-catch-ups"))).status,401);
    process.env.CRON_SECRET="fixture-secret-only";
    assert.equal((await GET(new Request("https://example.test/api/cron/expire-catch-ups",{headers:{authorization:"Bearer incorrect"}}))).status,401);
  } finally { if(old===undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=old; }
});

test("authorized retention cron runs cleanup and returns no private content", async t => {
  const old = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "fixture-secret-only";
  const cleanup = t.mock.method(ConversationSummaryService.prototype, "purgeExpired", async () => 3);
  // The constructor needs a pool even though this endpoint test stubs the cleanup.
  const oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://127.0.0.1:1/unused";
  try {
    const response = await GET(new Request("https://example.test/api/cron/expire-catch-ups", { headers: { authorization: "Bearer fixture-secret-only" } }));
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(), { deleted: 3 });
    assert.equal(cleanup.mock.callCount(),1);
  } finally {
    if(old===undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=old;
    if(oldUrl===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=oldUrl;
  }
});
