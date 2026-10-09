import { timingSafeEqual } from "node:crypto";
import { runRetentionCleanup } from "@/server/retention-cleanup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return new Response("Unauthorized", { status: 401 });
  return runRetentionCleanup();
}
