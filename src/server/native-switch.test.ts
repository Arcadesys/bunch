import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateKeyPair, SignJWT } from "jose";
import { nativeSwitchRequest, SWITCH_SCOPE, type SwitchDeps } from "./native-switch";
import { verifyRosterToken } from "./native-roster";

test("switch API requires its own scoped token and bounds changes to reviewed selections", async () => {
  const {privateKey,publicKey}=await generateKeyPair("RS256");
  const config={issuer:"https://fixture.example/",audience:"https://fixture.example/native-host",clientId:"fixture",jwksUri:new URL("https://fixture.example/keys")};
  const token = (scope:string,audience=config.audience,exp="5m") => new SignJWT({scope,azp:config.clientId}).setProtectedHeader({alg:"RS256"}).setSubject("fixture").setIssuer(config.issuer).setAudience(audience).setExpirationTime(exp).sign(privateKey);
  const calls:string[]=[]; const id=randomUUID(), member=randomUUID();
  const deps:SwitchDeps={authorize:(t,s)=>verifyRosterToken(t,config,async()=>publicKey,s),current:async owner=>{calls.push(owner);return {fronting:[{id,alterId:member,alterName:"Fictional",version:1}],legacy:null};},write:async(owner)=>{calls.push(owner);return {data:{started:[],ended:[]},replayed:false};},resolve:async()=>({outcome:"cancelled"})};
  const req=(method:string,t:string,body?:unknown)=>new Request("https://fixture.example/api/native-switch",{method,headers:{authorization:`Bearer ${t}`,"content-type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const good=await token(SWITCH_SCOPE), roster=await token("bunch:roster.read");
  assert.equal((await nativeSwitchRequest(req("GET",roster),deps)).status,401);
  assert.equal((await nativeSwitchRequest(req("GET",await token("bunch:host.write")),deps)).status,401);
  assert.equal((await nativeSwitchRequest(req("GET",await token(SWITCH_SCOPE,"https://fixture.example/mcp")),deps)).status,401);
  assert.equal((await nativeSwitchRequest(req("GET",await token(SWITCH_SCOPE,config.audience,"1 second ago")),deps)).status,401);
  const current=await (await nativeSwitchRequest(req("GET",good),deps)).json();
  assert.match(current.ownerKey,/^[a-f0-9]{64}$/); assert.deepEqual(current.data,[{id,alterId:member,alterName:"Fictional",version:1}]);
  assert.equal((await nativeSwitchRequest(req("POST",good,{requestId:randomUUID(),reviewed:[],end:[{id,version:1}],start:[]}),deps)).status,400);
  assert.equal((await nativeSwitchRequest(req("POST",good,{requestId:randomUUID(),reviewed:[{id,version:1}],end:[{id,version:1}],start:[]}),deps)).status,200);
  const malformed=new Request("https://fixture.example/api/native-switch",{method:"POST",headers:{authorization:`Bearer ${good}`,"content-type":"application/json-evil"},body:"{}"});
  assert.equal((await nativeSwitchRequest(malformed,deps)).status,400);
  const large=new Request("https://fixture.example/api/native-switch",{method:"POST",headers:{authorization:`Bearer ${good}`,"content-type":"application/json"},body:"x".repeat(32769)});
  assert.equal((await nativeSwitchRequest(large,deps)).status,400);
  assert.deepEqual(calls,["auth0:fixture","auth0:fixture"]);
});
