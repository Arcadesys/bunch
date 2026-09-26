import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { repository } from "@/server/repository";
import { readPrivateImage } from "@/server/private-images";
import { TelegramStickerService, configuredTelegramAccount, telegramApi, telegramPackSchema } from "@/server/telegram-stickers";

export async function readTelegramStickerImage(ownerId: string, imageId: string) {
  const image = await repository.getImage(ownerId, imageId);
  if (!image) throw new Error("Selected sticker image was not found in this Bunch account.");
  const stored = await readPrivateImage(image.storageKey);
  const reader = new Response(stored.body).body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > 512 * 1024) throw new Error("Each sticker must be at most 512 KB.");
      chunks.push(next.value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export function registerTelegramStickerTools(server: McpServer, ownerId: string, service = new TelegramStickerService({
  account: configuredTelegramAccount, image: readTelegramStickerImage, api: telegramApi,
})) {
  server.registerTool("prepare_telegram_sticker_pack", {
    title: "Prepare Telegram sticker upload",
    description: "Validate explicitly selected private PNG image IDs and prepare a 15-minute review of the exact Telegram pack, owner, emoji and keywords. Reads Telegram bot identity and private-chat metadata but uploads no images. Use the existing private image upload workflow first when needed. Never request a bot token in chat. Review the returned warning and ask for publication approval if the user has not already authorized this exact pack.",
    inputSchema: telegramPackSchema.shape,
    outputSchema: telegramPackSchema.extend({ name: z.string(), botUsername: z.string(), userId: z.number(), expiresAt: z.number(), hashes: z.array(z.string()), approvalToken: z.string(), warning: z.string() }).shape,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: false },
  }, async input => {
    const prepared = await service.prepare(ownerId, input);
    return { structuredContent: prepared, content: [{ type: "text", text: `Prepared ${prepared.stickers.length} stickers for ${prepared.name}. ${prepared.warning}` }] };
  });
  server.registerTool("publish_telegram_sticker_pack", {
    title: "Publish approved Telegram sticker pack",
    description: "Upload the exact reviewed pack to Telegram only after explicit user authorization to publish it as a shareable sticker pack. Pass its approvalToken unchanged and confirmPublicUpload=true. Never infer authorization from a ZIP, manifest, draft save or prepare request. Existing names are returned without changes; uncertain outcomes must be checked using the same name. This never sends chat messages, deletes stickers, or appends to existing packs.",
    inputSchema: { approvalToken: z.string().min(1).max(100_000), confirmPublicUpload: z.literal(true) },
    outputSchema: { name: z.string(), url: z.string(), expectedCount: z.number(), actualCount: z.number().nullable(), status: z.enum(["existing_unverified", "uncertain", "created_unverified", "created_verified"]), message: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  }, async input => {
    const result = await service.publish(ownerId, input.approvalToken, input.confirmPublicUpload);
    return { structuredContent: result, content: [{ type: "text", text: `${result.message} ${result.url}` }] };
  });
}
