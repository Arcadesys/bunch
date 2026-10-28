import { getPilotService } from "@/server/pilot-service";
import { getSystemService } from "@/server/system-service";
import { verifyRosterToken } from "@/server/native-roster";
import type { SwitchDeps } from "@/server/native-switch";

export const nativeSwitchDeps: SwitchDeps = {
  authorize: async (token,scope) => {
    const domain=process.env.AUTH0_DOMAIN, clientId=process.env.NATIVE_ROSTER_CLIENT_ID, audience=process.env.NATIVE_ROSTER_RESOURCE_URL;
    if (!domain || !clientId || audience!=="https://system.thearcades.me/native-host") throw new Error("Unavailable");
    const issuer=`https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
    const owner=await verifyRosterToken(token,{issuer,clientId,audience,jwksUri:new URL(".well-known/jwks.json",issuer)},undefined,scope);
    await getPilotService().assertAccess(owner,"mcp"); return owner;
  },
  current: async owner => {const current=await getSystemService().getCurrentPresence(owner); return {fronting:current.fronting,legacy:current.legacyCurrentFront};},
  write: (owner,input) => getSystemService().recordNativeSwitch(owner,input,"SYSTEM"),
  resolve: (owner,input) => getSystemService().resolveNativeSwitch(owner,input),
};
