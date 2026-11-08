import { nativeAuthConfig } from "@/server/native-auth-config";
import { getPilotService } from "@/server/pilot-service";
import { getSystemService } from "@/server/system-service";
import { verifyRosterToken } from "@/server/native-roster";
import type { SwitchDeps } from "@/server/native-switch";

export const nativeSwitchDeps: SwitchDeps = {
  authorize: async (token,scope) => {
    const owner=await verifyRosterToken(token,nativeAuthConfig(),undefined,scope);
    await getPilotService().assertAccess(owner,"mcp"); return owner;
  },
  current: async owner => {const current=await getSystemService().getCurrentPresence(owner); return {fronting:current.fronting,legacy:current.legacyCurrentFront};},
  write: (owner,input) => getSystemService().recordNativeSwitch(owner,input,"SYSTEM"),
  resolve: (owner,input) => getSystemService().resolveNativeSwitch(owner,input),
};
