import { nativeRosterRequest } from "@/server/native-roster";
import { nativeRosterDeps } from "@/server/native-roster-runtime";
export const runtime="nodejs";
export async function GET(request: Request, {params}:{params: Promise<{memberId:string}>}) {
  return nativeRosterRequest(request,"avatar",nativeRosterDeps,(await params).memberId);
}
