import { nativeRosterRequest } from "@/server/native-roster";
import { nativeRosterDeps } from "@/server/native-roster-runtime";
export const runtime="nodejs";
export const GET=(request: Request) => nativeRosterRequest(request,"members",nativeRosterDeps);
