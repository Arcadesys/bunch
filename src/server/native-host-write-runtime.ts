import {nativeSwitchDeps} from "@/server/native-switch-runtime";
import {getSystemService} from "@/server/system-service";
import type {HostDeps} from "@/server/native-host-write";
export const nativeHostWriteDeps:HostDeps={authorize:nativeSwitchDeps.authorize,current:owner=>getSystemService().getSystemHost(owner),write:(owner,input)=>getSystemService().setNativeHost(owner,input,"SYSTEM"),resolve:(owner,input)=>getSystemService().resolveNativeHost(owner,input)};
