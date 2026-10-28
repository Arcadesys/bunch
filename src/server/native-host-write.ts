import {createHash} from "node:crypto";
import {nativeHostWriteSchema,type NativeHostWrite} from "@/domain/native-host-write";
export const HOST_SCOPE="bunch:host.write";
type Host={id:string;alterId:string|null;alterName:string|null;version:number};
export type HostDeps={authorize:(token:string,scope:string)=>Promise<string>;current:(owner:string)=>Promise<Host|null>;write:(owner:string,input:NativeHostWrite)=>Promise<{data:Host;replayed:boolean}>;resolve:(owner:string,input:NativeHostWrite)=>Promise<{outcome:"recorded"|"cancelled";data?:Host}>};
const headers={"Cache-Control":"private, no-store","Vercel-CDN-Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
export async function nativeHostWriteRequest(req:Request,deps:HostDeps,resolve=false):Promise<Response>{
 if((resolve&&req.method!=="POST")||(!resolve&&req.method!=="GET"&&req.method!=="POST"))return json({error:"method_not_allowed"},405);
 const auth=req.headers.get("authorization");if(!auth||!/^Bearer [^\s]+$/.test(auth))return json({error:"unauthorized"},401);
 let owner:string;try{owner=await deps.authorize(auth.slice(7),HOST_SCOPE);}catch{return json({error:"unauthorized"},401);}
 if(new URL(req.url).search)return json({error:"invalid_request"},400);
 try{
  if(req.method==="GET"){const current=await deps.current(owner);return json({ownerKey:createHash("sha256").update(owner).digest("hex"),data:current?{alterId:current.alterId,alterName:current.alterName,version:current.version}:null});}
  if(req.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")return json({error:"invalid_request"},400);
  const length=req.headers.get("content-length");if(length&&(!/^\d+$/.test(length)||Number(length)>4096))return json({error:"invalid_request"},400);if(!req.body)return json({error:"invalid_request"},400);
  const reader=req.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});let text="",size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>4096){await reader.cancel();return json({error:"invalid_request"},400);}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}catch{return json({error:"invalid_request"},400);}
  let body:unknown;try{body=JSON.parse(text);}catch{return json({error:"invalid_request"},400);}
  const parsed=nativeHostWriteSchema.safeParse(body);if(!parsed.success)return json({error:"invalid_request"},400);
  if(resolve){const result=await deps.resolve(owner,parsed.data);return json({requestId:parsed.data.requestId,outcome:result.outcome,...(result.data?{host:{alterId:result.data.alterId,version:result.data.version}}:{})});}
  const result=await deps.write(owner,parsed.data);return json({requestId:parsed.data.requestId,replayed:result.replayed,host:{alterId:result.data.alterId,version:result.data.version}});
 }catch(error){if(typeof error==="object"&&error&&"code" in error&&error.code==="CONFLICT")return json({error:"conflict"},409);if(typeof error==="object"&&error&&"code" in error&&error.code==="NOT_FOUND")return json({error:"not_found"},404);return json({error:"unavailable"},503);}
}
