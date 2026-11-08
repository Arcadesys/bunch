import { nativeSwitchRequest } from "@/server/native-switch";
import { nativeSwitchDeps } from "@/server/native-switch-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => nativeSwitchRequest(request,nativeSwitchDeps);
export const POST = (request: Request) => nativeSwitchRequest(request,nativeSwitchDeps);
