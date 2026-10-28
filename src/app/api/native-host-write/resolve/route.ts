import {nativeHostWriteRequest} from "@/server/native-host-write";
import {nativeHostWriteDeps} from "@/server/native-host-write-runtime";
export const runtime="nodejs";
export const POST=(request:Request)=>nativeHostWriteRequest(request,nativeHostWriteDeps,true);
