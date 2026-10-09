import { requireOwnerId } from "@/server/auth";
import { callbackTelegramLink, readTelegramSession, telegramLinkErrorResponse } from "@/server/telegram-link";

export async function GET(request: Request) {
  let owner: string | null = null;
  try { owner = await requireOwnerId(request); } catch { /* callback returns a safe account-page error */ }
  try { return await callbackTelegramLink(request, owner, readTelegramSession(request)); }
  catch (error) { return telegramLinkErrorResponse(error); }
}
