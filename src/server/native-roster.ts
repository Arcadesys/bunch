import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ownerIdFromAuth0Subject } from "@/server/auth";
import { z } from "zod";

export const ROSTER_SCOPE = "bunch:roster.read";
export type RosterAuthConfig = {issuer: string; audience: string; clientId: string; jwksUri: URL};
export async function verifyRosterToken(token: string, config: RosterAuthConfig, key: JWTVerifyGetKey = createRemoteJWKSet(config.jwksUri)): Promise<string> {
  if (!config.clientId || !config.issuer || !config.audience) throw new Error("Unavailable");
  const {payload} = await jwtVerify(token, key, {algorithms:["RS256"], issuer:config.issuer, audience:config.audience});
  const client = payload.client_id ?? payload.azp;
  if (!payload.sub || client !== config.clientId || (payload.client_id !== undefined && payload.azp !== undefined && payload.client_id !== payload.azp) || typeof payload.exp !== "number" || typeof payload.scope !== "string" || !payload.scope.split(/\s+/).includes(ROSTER_SCOPE)) throw new Error("Unauthorized");
  return ownerIdFromAuth0Subject(payload.sub);
}
export type Member = {id: string; name: string; hasAvatar: boolean};
export type RosterDeps = {
  authorize: (token: string) => Promise<string>;
  host: (owner: string) => Promise<{alterId: string | null; alterName: string | null} | null>;
  members: (owner: string, cursor?: string) => Promise<{data: Member[]; nextCursor?: string}>;
  avatar: (owner: string, memberId: string) => Promise<{body: BodyInit; contentType: string} | null>;
};
const headers = {"Cache-Control":"private, no-store", "Vercel-CDN-Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer"};
const json = (body: unknown, status=200) => Response.json(body,{status,headers});
export async function nativeRosterRequest(request: Request, kind: "host" | "members" | "avatar", deps: RosterDeps, memberId?: string): Promise<Response> {
  if (request.method !== "GET") return json({error:"method_not_allowed"},405);
  try {
    const authorization=request.headers.get("authorization");
    if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) return json({error:"unauthorized"},401);
    let owner: string;
    try { owner=await deps.authorize(authorization.slice(7)); } catch { return json({error:"unauthorized"},401); }
    const params=new URL(request.url).searchParams;
    if ([...params.keys()].some(k => k !== "cursor") || (kind!=="members" && params.size>0) || params.getAll("cursor").length>1) return json({error:"invalid_request"},400);
    if (kind==="host") { const host=await deps.host(owner); return json({data:host ? {alterId:host.alterId,alterName:host.alterName} : null}); }
    if (kind==="members") {
      const cursor=params.get("cursor") ?? undefined;
      if (cursor && cursor.length>1024) return json({error:"invalid_request"},400);
      const page=await deps.members(owner,cursor);
      return json({data:page.data.map(({id,name,hasAvatar})=>({id,name,hasAvatar})),meta:{nextCursor:page.nextCursor}});
    }
    if (!z.string().uuid().safeParse(memberId).success) return json({error:"not_found"},404);
    const avatar=await deps.avatar(owner,memberId!);
    if (!avatar || !["image/jpeg","image/png","image/webp"].includes(avatar.contentType)) return json({error:"not_found"},404);
    return new Response(avatar.body,{headers:{...headers,"Content-Type":avatar.contentType,"Cross-Origin-Resource-Policy":"same-origin"}});
  } catch { return json({error:"unavailable"},503); }
}
