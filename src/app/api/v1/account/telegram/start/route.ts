import { apiOwner, jsonBody, requireStrictSameOriginJson } from "@/server/http-api";
import { readTelegramSession, startTelegramLink, telegramLinkErrorResponse, telegramSessionSetCookie } from "@/server/telegram-link";

export async function POST(request: Request) {
  try {
    requireStrictSameOriginJson(request);
    const owner = await apiOwner(request);
    const body = await jsonBody(request);
    const result = await startTelegramLink(owner, readTelegramSession(request), typeof body.intent === "string" ? body.intent : null);
    const response = Response.json(result.state === "disabled" ? result : { authorizationUrl: result.authorizationUrl, expiresAt: result.expiresAt }, { headers: { "Cache-Control": "private, no-store" } });
    if (result.state !== "disabled" && result.createdSession) response.headers.append("Set-Cookie", telegramSessionSetCookie(result.session));
    return response;
  } catch (error) { return telegramLinkErrorResponse(error); }
}
