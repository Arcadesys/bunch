import {nativeHostWriteRequest} from "@/server/native-host-write";
import {nativeHostWriteDeps} from "@/server/native-host-write-runtime";
export const runtime="nodejs";
export const GET=(request:Request)=>nativeHostWriteRequest(request,nativeHostWriteDeps);
export const POST=(request:Request)=>nativeHostWriteRequest(request,nativeHostWriteDeps);
