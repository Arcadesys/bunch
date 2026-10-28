import { getDatabasePool } from "@/db/client";
import { getSystemService } from "@/server/system-service";
import { getPilotService } from "@/server/pilot-service";
import { selectedAvatar } from "@/server/native-roster-avatar";
import { readPrivateImage } from "@/server/private-images";
import { verifyRosterToken, type RosterDeps } from "@/server/native-roster";

export const nativeRosterDeps: RosterDeps = {
  authorize: async token => {
    const domain=process.env.AUTH0_DOMAIN, clientId=process.env.NATIVE_ROSTER_CLIENT_ID, audience=process.env.NATIVE_ROSTER_RESOURCE_URL;
    if (!domain || !clientId || audience!=="https://system.thearcades.me/native-host") throw new Error("Unavailable");
    const issuer=`https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
    const owner=await verifyRosterToken(token,{issuer,clientId,audience,jwksUri:new URL(".well-known/jwks.json",issuer)});
    await getPilotService().assertAccess(owner,"mcp");
    return owner;
  },
  host: owner => getSystemService().getSystemHost(owner),
  members: async (owner,cursor) => {
    const page=await getSystemService().listAlters(owner,{limit:50,cursor});
    return {data:page.data.map(p=>({id:p.id,name:p.name,hasAvatar:!!p.profilePicture})),nextCursor:page.nextCursor};
  },
  avatar: async (owner,memberId) => {
    const image=await selectedAvatar(getDatabasePool(),owner,memberId); if (!image) return null;
    const stored=await readPrivateImage(image.storage_key);
    return {body:stored.body,contentType:image.content_type};
  },
};
