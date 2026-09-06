import { timingSafeEqual } from "node:crypto";
import { ConversationSummaryService } from "@/server/conversation-summary-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return new Response("Unauthorized", { status: 401 });
  try {
    const deleted = await new ConversationSummaryService().purgeExpired();
    return Response.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("CATCH_UP_RETENTION_FAILED");
    return Response.json({ error: "Retention cleanup failed; retry required." }, { status: 500 });
  }
}
