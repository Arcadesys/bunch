import { apiOwner, jsonBody, requireStrictSameOriginJson } from "@/server/http-api";
import { confirmTelegramLink, readTelegramSession, telegramLinkErrorResponse } from "@/server/telegram-link";

export async function POST(request: Request) {
  try {
    requireStrictSameOriginJson(request);
    const owner = await apiOwner(request);
    const body = await jsonBody(request);
    return Response.json(await confirmTelegramLink(owner, readTelegramSession(request), body.confirmationId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return telegramLinkErrorResponse(error); }
}
