import { nativeSwitchSchema, type NativeSwitch } from "@/domain/native-switch";
import { createHash } from "node:crypto";

export const SWITCH_SCOPE = "bunch:front.write";
type Front = { id: string; alterId: string; alterName: string; version: number };
export type SwitchDeps = {
  authorize: (token: string, scope: string) => Promise<string>;
  current: (owner: string) => Promise<{fronting: Front[]; legacy: {alterName:string} | null}>;
  write: (owner: string, input: NativeSwitch) => Promise<{replayed:boolean;data:{started:Front[];ended:Front[]}}>;
  resolve: (owner: string, input: NativeSwitch) => Promise<{outcome:"cancelled"|"recorded";data?:{started:Front[];ended:Front[]}}>;
};
const headers = {"Cache-Control":"private, no-store", "Vercel-CDN-Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer"};
const json = (body: unknown, status=200) => Response.json(body,{status,headers});
export async function nativeSwitchRequest(req: Request, deps: SwitchDeps, resolve=false): Promise<Response> {
  if (resolve && req.method!=="POST") return json({error:"method_not_allowed"},405);
  if (req.method !== "GET" && req.method !== "POST") return json({error:"method_not_allowed"},405);
  const auth = req.headers.get("authorization");
  if (!auth || !/^Bearer [^\s]+$/.test(auth)) return json({error:"unauthorized"},401);
  let owner: string;
  try { owner = await deps.authorize(auth.slice(7), SWITCH_SCOPE); } catch { return json({error:"unauthorized"},401); }
  if (new URL(req.url).search) return json({error:"invalid_request"},400);
  try {
    if (req.method === "GET") { const current=await deps.current(owner); return json({ownerKey:createHash("sha256").update(owner).digest("hex"),legacy:current.legacy ? {alterName:current.legacy.alterName} : null,data:current.fronting.map(({id,alterId,alterName,version})=>({id,alterId,alterName,version}))}); }
    if (req.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase() !== "application/json") return json({error:"invalid_request"},400);
    const length=req.headers.get("content-length"); if (length && (!/^\d+$/.test(length) || Number(length)>32768)) return json({error:"invalid_request"},400);
    if (!req.body) return json({error:"invalid_request"},400);
    const reader=req.body.getReader(), decoder=new TextDecoder("utf-8",{fatal:true}); let size=0,text="";
    try { while(true) { const part=await reader.read(); if(part.done) break; size+=part.value.byteLength; if(size>32768){await reader.cancel();return json({error:"invalid_request"},400);} text+=decoder.decode(part.value,{stream:true}); } text+=decoder.decode(); }
    catch { return json({error:"invalid_request"},400); }
    let body: unknown; try { body = JSON.parse(text); } catch { return json({error:"invalid_request"},400); }
    const parsed = nativeSwitchSchema.safeParse(body);
    if (!parsed.success) return json({error:"invalid_request"},400);
    if(resolve) {const result=await deps.resolve(owner,parsed.data);return json({requestId:parsed.data.requestId,outcome:result.outcome,...(result.data?{started:result.data.started.map(({id,alterId})=>({id,alterId})),ended:result.data.ended.map(({id,alterId})=>({id,alterId}))}:{})});}
    const result=await deps.write(owner,parsed.data);
    return json({requestId:parsed.data.requestId,replayed:result.replayed,started:result.data.started.map(({id,alterId})=>({id,alterId})),ended:result.data.ended.map(({id,alterId})=>({id,alterId}))});
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "CONFLICT") return json({error:"conflict"},409);
    if (typeof error === "object" && error && "code" in error && error.code === "NOT_FOUND") return json({error:"not_found"},404);
    return json({error:"unavailable"},503);
  }
}
