import { NextResponse } from "next/server";
import { apiOwner, apiResponse } from "@/server/http-api";
import { getSystemService } from "@/server/system-service";
type Context = { params: Promise<{ id: string }> };
export const runtime = "nodejs";
export async function GET(request: Request, { params }: Context) { return apiResponse(async () => { const ownerId = await apiOwner(request); const { id } = await params; return NextResponse.json({ data: await getSystemService().previewEraseAlter(ownerId, id), meta: {} }); }); }
