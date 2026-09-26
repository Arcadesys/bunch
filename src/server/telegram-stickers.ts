import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";

const textLength = (s: string) => Array.from(s).length;
const shortText = z.string().min(1).refine(s => textLength(s) <= 64);
export const telegramPackSchema = z.object({
  title: shortText,
  slug: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/).max(32),
  stickers: z.array(z.object({
    imageId: z.string().uuid(),
    emoji_list: z.array(z.string().trim().min(1).max(32)).min(1).max(20),
    keywords: z.array(shortText).max(20).default([]).refine(xs => xs.reduce((n, s) => n + textLength(s), 0) <= 64),
  }).strict()).min(1).max(50).refine(xs => new Set(xs.map(x => x.imageId)).size === xs.length, "Select each image only once."),
}).strict();
export type TelegramPack = z.infer<typeof telegramPackSchema>;
export type TelegramAccount = { token: string; userId: number };
export type TelegramCall = (method: string, fields: Record<string, unknown>, files?: Uint8Array[]) => Promise<unknown>;
export type TelegramDependencies = {
  account: (ownerId: string) => TelegramAccount;
  image: (ownerId: string, imageId: string) => Promise<Uint8Array>;
  api: (account: TelegramAccount) => TelegramCall;
  now?: () => number;
};
const accountSchema = z.object({ token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/), userId: z.number().int().positive().safe() });

// No credential or Telegram-owner override is accepted in model-visible arguments.
export function configuredTelegramAccount(ownerId: string, raw = process.env.TELEGRAM_STICKER_ACCOUNTS): TelegramAccount {
  try {
    const accounts = JSON.parse(raw ?? "{}");
    if (!Object.hasOwn(accounts, ownerId)) throw new Error();
    return accountSchema.parse(accounts[ownerId]);
  } catch {
    throw new Error("Telegram sticker publishing is not configured for this Bunch account. Ask the operator to configure its Telegram bot secret and verified private-chat user ID outside chat.");
  }
}

export class TelegramRequestError extends Error {
  constructor(public code: number, public uncertain = false, public retryAfter?: number, public missingSet = false) {
    super(code === 429 ? `Telegram rate limit. Retry after ${retryAfter ?? 60} seconds.` : uncertain ? "Telegram request outcome is uncertain. Check the same pack name before retrying." : "Telegram rejected the request. Check the bot configuration and sticker requirements.");
  }
}

export function telegramApi(account: TelegramAccount, fetcher: typeof fetch = fetch): TelegramCall {
  return async (method, fields, files) => {
    if (!["getMe", "getChat", "getStickerSet", "createNewStickerSet"].includes(method)) throw new Error("Unsupported Telegram operation.");
    let body: BodyInit;
    let headers: Record<string, string> | undefined;
    if (files) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, typeof value === "string" ? value : JSON.stringify(value));
      files.forEach((bytes, i) => form.set(`sticker_${i}`, new Blob([new Uint8Array(bytes)], { type: "image/png" }), `sticker_${i}.png`));
      body = form;
    } else { body = JSON.stringify(fields); headers = { "Content-Type": "application/json" }; }
    let response: Response;
    let result: { ok?: boolean; result?: unknown; error_code?: number; description?: string; parameters?: { retry_after?: number } };
    try {
      response = await fetcher(`https://api.telegram.org/bot${account.token}/${method}`, {
        method: "POST", body, headers, redirect: "error", signal: AbortSignal.timeout(45_000),
      });
      result = await response.json();
      if (!result || typeof result !== "object") throw new Error();
    } catch { throw new TelegramRequestError(0, true); } // Never expose credential-bearing URLs or response bodies.
    if (response.ok && result.ok === true) return result.result;
    const code = typeof result.error_code === "number" ? result.error_code : response.status;
    const delay = result.parameters?.retry_after;
    const retryAfter = typeof delay === "number" && Number.isInteger(delay) && delay >= 0 && delay <= 86_400 ? delay : undefined;
    throw new TelegramRequestError(code, code >= 500, retryAfter,
      code === 400 && typeof result.description === "string" && result.description.toUpperCase().includes("STICKERSET_INVALID"));
  };
}

export function telegramPackName(slug: string, userId: number, username: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(username) || username.includes("__")) throw new Error("Telegram returned an invalid bot username.");
  const suffix = `_${userId}_by_${username}`;
  const stem = slug.slice(0, 64 - suffix.length).replace(/_+$/, "");
  if (!stem) throw new Error("Telegram pack name is too long.");
  return stem + suffix;
}

export async function validateTelegramPng(bytes: Uint8Array) {
  if (bytes.length > 512 * 1024 || bytes.length < 8 || Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a") throw new Error("Each sticker must be a PNG of at most 512 KB.");
  try {
    const decoder = sharp(bytes, { limitInputPixels: 512 * 512, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) !== 512 || !metadata.hasAlpha || (metadata.pages ?? 1) !== 1) throw new Error();
    const stats = await decoder.stats(); // Decode pixel data, not just the container header.
    if (stats.isOpaque) throw new Error();
  } catch { throw new Error("Each sticker must be a decodable transparent static PNG with one side 512px and neither side larger."); }
}

const approvalSchema = telegramPackSchema.extend({
  name: z.string(), botUsername: z.string(), userId: z.number(), expiresAt: z.number(),
  hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
});
type Approval = z.infer<typeof approvalSchema>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const signature = (owner: string, token: string, payload: string) => createHmac("sha256", token).update(JSON.stringify(["bunch-telegram-v1", owner, payload])).digest();
const stickerSetSchema = z.object({ name: z.string(), title: z.string(), stickers: z.array(z.unknown()) });

export class TelegramStickerService {
  constructor(private readonly deps: TelegramDependencies) {}
  private now() { return (this.deps.now ?? Date.now)(); }
  private async images(owner: string, pack: TelegramPack) {
    const files: Uint8Array[] = [];
    for (const sticker of pack.stickers) {
      const bytes = await this.deps.image(owner, sticker.imageId);
      await validateTelegramPng(bytes);
      files.push(bytes);
    }
    return files;
  }
  async prepare(owner: string, input: TelegramPack) {
    const pack = telegramPackSchema.parse(input);
    const account = this.deps.account(owner);
    const files = await this.images(owner, pack);
    const api = this.deps.api(account);
    const bot = z.object({ is_bot: z.literal(true), username: z.string() }).parse(await api("getMe", {}));
    const chat = z.object({ id: z.number(), type: z.literal("private") }).parse(await api("getChat", { chat_id: account.userId }));
    if (chat.id !== account.userId) throw new Error("Telegram owner verification failed.");
    const approval: Approval = { ...pack, name: telegramPackName(pack.slug, account.userId, bot.username), botUsername: bot.username,
      userId: account.userId, expiresAt: this.now() + 15 * 60_000, hashes: files.map(hash) };
    const payload = Buffer.from(JSON.stringify(approval)).toString("base64url");
    return { ...approval, approvalToken: `${payload}.${signature(owner, account.token, payload).toString("base64url")}`,
      warning: "Publishing copies these images to Telegram as a shareable sticker pack. They are no longer confined to the private Bunch gallery." };
  }
  async publish(owner: string, approvalToken: string, confirmPublicUpload: boolean) {
    if (confirmPublicUpload !== true) throw new Error("Explicit approval of this pack's public upload is required.");
    const account = this.deps.account(owner);
    let approval: Approval;
    try {
      const [payload, signed, extra] = approvalToken.split(".");
      const supplied = Buffer.from(signed, "base64url");
      const expected = signature(owner, account.token, payload);
      if (extra || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
      approval = approvalSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
      if (approval.expiresAt <= this.now() || approval.userId !== account.userId) throw new Error();
    } catch { throw new Error("This pack approval is invalid or expired. Prepare and review the pack again."); }
    const files = await this.images(owner, approval);
    if (JSON.stringify(files.map(hash)) !== JSON.stringify(approval.hashes)) throw new Error("Sticker images changed after preparation. Prepare and review the pack again.");
    const api = this.deps.api(account);
    const base = { name: approval.name, url: `https://t.me/addstickers/${approval.name}`, expectedCount: files.length };
    try {
      const existing = stickerSetSchema.parse(await api("getStickerSet", { name: approval.name }));
      return { ...base, status: "existing_unverified" as const, actualCount: existing.stickers.length,
        message: "This name already exists. Nothing was uploaded or changed; its contents have not been matched to this draft. Use a new slug for a revised pack." };
    } catch (error) { if (!(error instanceof TelegramRequestError && error.missingSet)) throw error; }
    try {
      const accepted = await api("createNewStickerSet", {
        user_id: account.userId, name: approval.name, title: approval.title, sticker_type: "regular",
        stickers: approval.stickers.map((s, i) => ({ sticker: `attach://sticker_${i}`, format: "static", emoji_list: s.emoji_list, keywords: s.keywords })),
      }, files);
      if (accepted !== true) throw new TelegramRequestError(0, true);
    } catch (error) {
      if (error instanceof TelegramRequestError && error.uncertain) return { ...base, status: "uncertain" as const, actualCount: null,
        message: "Telegram may have created the pack. Check this exact name; do not append stickers or choose a new name to retry." };
      throw error;
    }
    try {
      const remote = stickerSetSchema.parse(await api("getStickerSet", { name: approval.name }));
      if (remote.name !== approval.name || remote.title !== approval.title || remote.stickers.length !== files.length) return { ...base, status: "created_unverified" as const, actualCount: remote.stickers.length, message: "Telegram accepted creation, but its returned name, title or count differs. Inspect the pack." };
      return { ...base, status: "created_verified" as const, actualCount: remote.stickers.length, message: "Telegram accepted creation; the resulting pack name, title and sticker count were verified." };
    } catch { return { ...base, status: "created_unverified" as const, actualCount: null, message: "Telegram accepted creation, but the follow-up read failed. Inspect the pack link." }; }
  }
}
