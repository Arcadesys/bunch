import { apiOwner, requireStrictSameOriginJson } from "@/server/http-api";
import { recheckTelegramLink, telegramLinkErrorResponse } from "@/server/telegram-link";

export async function POST(request: Request) {
  try {
    requireStrictSameOriginJson(request);
    const owner = await apiOwner(request);
    return Response.json(await recheckTelegramLink(owner), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return telegramLinkErrorResponse(error); }
}
