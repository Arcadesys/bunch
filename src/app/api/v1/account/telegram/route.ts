import { apiOwner, jsonBody, requireStrictSameOriginJson } from "@/server/http-api";
import { disconnectTelegramLink, getTelegramLinkStatus, readTelegramSession, telegramLinkErrorResponse } from "@/server/telegram-link";

export async function GET(request: Request) {
  try {
    const owner = await apiOwner(request);
    return Response.json(await getTelegramLinkStatus(owner, readTelegramSession(request), new URL(request.url).searchParams.get("confirmation")), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return telegramLinkErrorResponse(error); }
}

export async function DELETE(request: Request) {
  try {
    requireStrictSameOriginJson(request);
    const owner = await apiOwner(request);
    return Response.json(await disconnectTelegramLink(owner), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return telegramLinkErrorResponse(error); }
}
