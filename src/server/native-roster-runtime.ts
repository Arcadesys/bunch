import { nativeAuthConfig } from "@/server/native-auth-config";
import { getDatabasePool } from "@/db/client";
import { getSystemService } from "@/server/system-service";
import { getPilotService } from "@/server/pilot-service";
import { selectedAvatar } from "@/server/native-roster-avatar";
import { readPrivateImage } from "@/server/private-images";
import { verifyRosterToken, type RosterDeps } from "@/server/native-roster";

export const nativeRosterDeps: RosterDeps = {
  authorize: async token => {
    const owner=await verifyRosterToken(token,nativeAuthConfig());
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
