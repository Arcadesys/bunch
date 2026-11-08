import { ConversationSummaryService } from "@/server/conversation-summary-service";
import { purgeExpiredTelegramLinkMaterial } from "@/server/telegram-link";

export async function runRetentionCleanup(
  summaries = new ConversationSummaryService(),
  purgeTelegram = purgeExpiredTelegramLinkMaterial,
) {
  try {
    const deleted = await summaries.purgeExpired();
    await purgeTelegram();
    return Response.json({ deleted }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("CATCH_UP_RETENTION_FAILED");
    return Response.json({ error: "Retention cleanup failed; retry required." }, { status: 500 });
  }
}
