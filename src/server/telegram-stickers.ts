import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { getDatabasePool } from "@/db/client";
import { TELEGRAM_LINK_ENV } from "@/domain/telegram-link";

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
export type TelegramAccount = { token: string; userId: number; connectionRevision?: number };
export type TelegramCall = (method: string, fields: Record<string, unknown>, files?: Uint8Array[]) => Promise<unknown>;
export type TelegramAttemptStatus = "STARTED" | "UNCERTAIN" | "ACCEPTED" | "VERIFIED" | "FAILED";
export type TelegramAttempt = { ownerId: string; connectionRevision: number; botId: string; packName: string; titleHash: string; contentHash: string; status: TelegramAttemptStatus };
export type TelegramAttemptStore = {
  find(ownerId: string, packName: string): Promise<TelegramAttempt | null>;
  begin(attempt: TelegramAttempt): Promise<boolean>;
  restartFailed(attempt: TelegramAttempt): Promise<boolean>;
  setStatus(ownerId: string, packName: string, status: TelegramAttemptStatus): Promise<void>;
};
export type TelegramDependencies = {
  account: (ownerId: string) => TelegramAccount | Promise<TelegramAccount>;
  image: (ownerId: string, imageId: string) => Promise<Uint8Array>;
  api: (account: TelegramAccount) => TelegramCall;
  attempts?: TelegramAttemptStore;
  publishBoundary?: <T>(ownerId: string, connectionRevision: number, telegramUserId: number, run: () => Promise<T>) => Promise<T>;
  now?: () => number;
};
// Resolve only from the authenticated Bunch owner and the one shared service bot.
export async function configuredTelegramAccount(ownerId: string): Promise<TelegramAccount> {
  const token = process.env[TELEGRAM_LINK_ENV.botToken];
  const clientId = process.env[TELEGRAM_LINK_ENV.oidcClientId];
  if (!token || !clientId || !new RegExp(`^${clientId}:[A-Za-z0-9_-]{20,}$`).test(token)) throw new Error("Telegram sticker publishing is not configured.");
  const row = (await getDatabasePool().query<{ telegram_user_id: string; connection_revision: number; bot_access: boolean }>(
    "select telegram_user_id,connection_revision,bot_access from telegram_connection where owner_id=$1", [ownerId])).rows[0];
  if (!row) throw new TelegramLinkRequiredError();
  const userId = Number(row.telegram_user_id);
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Telegram account connection is invalid.");
  if (!row.bot_access) throw new Error("Start the shared Bunch bot in Telegram, then recheck bot access in Account settings.");
  return { token, userId, connectionRevision: row.connection_revision };
}

export class TelegramLinkRequiredError extends Error {
  constructor() { super("Connect a Telegram account in Bunch Account settings before preparing a sticker pack."); }
}
export class TelegramConnectionChangedError extends Error {
  constructor() { super("The Telegram connection changed before publication. Prepare and review the pack again."); }
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

export function telegramPackName(slug: string, destinationNamespace: string, username: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(username) || username.includes("__")) throw new Error("Telegram returned an invalid bot username.");
  if (!/^[a-f0-9]{16}$/.test(destinationNamespace)) throw new Error("Telegram destination could not be verified.");
  const suffix = `_${destinationNamespace}_by_${username}`;
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
  name: z.string(), botUsername: z.string(), destinationNamespace: z.string().regex(/^[a-f0-9]{16}$/), connectionRevision: z.number().int().nonnegative(), botIdentityHash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number(),
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
  private attempts(): TelegramAttemptStore {
    if (this.deps.attempts) return this.deps.attempts;
    return {
      find: async (ownerId, packName) => {
        const row = (await getDatabasePool().query<{ owner_id: string; connection_revision: number; bot_id: string; pack_name: string; title_hash: string; content_hash: string; status: TelegramAttemptStatus }>(
          "select owner_id,connection_revision,bot_id,pack_name,title_hash,content_hash,status from telegram_publication_attempt where owner_id=$1 and pack_name=$2", [ownerId, packName])).rows[0];
        return row ? { ownerId: row.owner_id, connectionRevision: row.connection_revision, botId: row.bot_id, packName: row.pack_name, titleHash: row.title_hash, contentHash: row.content_hash, status: row.status } : null;
      },
      begin: async attempt => !!(await getDatabasePool().query(
        `insert into telegram_publication_attempt(owner_id,connection_revision,bot_id,pack_name,title_hash,content_hash,status)
         values($1,$2,$3,$4,$5,$6,$7) on conflict(owner_id,pack_name) do nothing returning id`,
        [attempt.ownerId,attempt.connectionRevision,attempt.botId,attempt.packName,attempt.titleHash,attempt.contentHash,attempt.status])).rowCount,
      restartFailed: async attempt => !!(await getDatabasePool().query(
        `insert into telegram_publication_attempt(owner_id,connection_revision,bot_id,pack_name,title_hash,content_hash,status)
         values($1,$2,$3,$4,$5,$6,'STARTED') on conflict(owner_id,pack_name) do update set connection_revision=excluded.connection_revision,bot_id=excluded.bot_id,title_hash=excluded.title_hash,content_hash=excluded.content_hash,status='STARTED',updated_at=now()
         where telegram_publication_attempt.status='FAILED' and telegram_publication_attempt.bot_id=excluded.bot_id and telegram_publication_attempt.title_hash=excluded.title_hash and telegram_publication_attempt.content_hash=excluded.content_hash returning id`,
        [attempt.ownerId,attempt.connectionRevision,attempt.botId,attempt.packName,attempt.titleHash,attempt.contentHash])).rowCount,
      setStatus: async (ownerId, packName, status) => { await getDatabasePool().query("update telegram_publication_attempt set status=$3,updated_at=now() where owner_id=$1 and pack_name=$2", [ownerId, packName, status]); },
  };
  }
  private async publishBoundary<T>(ownerId: string, account: TelegramAccount, run: () => Promise<T>) {
    if (this.deps.publishBoundary) return this.deps.publishBoundary(ownerId, account.connectionRevision ?? 0, account.userId, run);
    const client = await getDatabasePool().connect();
    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [ownerId]);
      const connection = (await client.query<{ telegram_user_id: string; connection_revision: number; bot_access: boolean }>(
        "select telegram_user_id,connection_revision,bot_access from telegram_connection where owner_id=$1 for update", [ownerId])).rows[0];
      if (!connection || Number(connection.telegram_user_id) !== account.userId || connection.connection_revision !== (account.connectionRevision ?? 0) || !connection.bot_access) {
        throw new TelegramConnectionChangedError();
      }
      const result = await run();
      await client.query("commit");
      return result;
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }
  async prepare(owner: string, input: TelegramPack) {
    const pack = telegramPackSchema.parse(input);
    const account = await this.deps.account(owner);
    const files = await this.images(owner, pack);
    const api = this.deps.api(account);
    const bot = z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(true), username: z.string() }).parse(await api("getMe", {}));
    if (String(bot.id) !== account.token.split(":", 1)[0]) throw new Error("Telegram bot identity could not be verified.");
    const chat = z.object({ id: z.number(), type: z.literal("private") }).parse(await api("getChat", { chat_id: account.userId }));
    if (chat.id !== account.userId) throw new Error("Telegram owner verification failed.");
    const botIdentityHash = createHash("sha256").update("bunch-telegram-bot-v1\0").update(String(bot.id)).digest("hex");
    const destinationNamespace = createHash("sha256").update("bunch-telegram-destination-v1\0").update(JSON.stringify([owner, account.userId, botIdentityHash])).digest("hex").slice(0, 16);
    const approval: Approval = { ...pack, name: telegramPackName(pack.slug, destinationNamespace, bot.username), botUsername: bot.username,
      destinationNamespace, botIdentityHash, connectionRevision: account.connectionRevision ?? 0, expiresAt: this.now() + 15 * 60_000, hashes: files.map(hash) };
    const payload = Buffer.from(JSON.stringify(approval)).toString("base64url");
    return { ...approval, approvalToken: `${payload}.${signature(owner, account.token, payload).toString("base64url")}`,
      warning: "Publishing copies these images to Telegram as a shareable sticker pack. They are no longer confined to the private Bunch gallery." };
  }
  async publish(owner: string, approvalToken: string, confirmPublicUpload: boolean) {
    if (confirmPublicUpload !== true) throw new Error("Explicit approval of this pack's public upload is required.");
    const account = await this.deps.account(owner);
    let approval: Approval;
    try {
      const [payload, signed, extra] = approvalToken.split(".");
      const supplied = Buffer.from(signed, "base64url");
      const expected = signature(owner, account.token, payload);
      if (extra || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error();
      approval = approvalSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
      const currentDestination = createHash("sha256").update("bunch-telegram-destination-v1\0").update(JSON.stringify([owner, account.userId, approval.botIdentityHash])).digest("hex").slice(0, 16);
      if (approval.expiresAt <= this.now() || approval.destinationNamespace !== currentDestination || approval.connectionRevision !== (account.connectionRevision ?? 0)) throw new Error();
    } catch { throw new Error("This pack approval is invalid or expired. Prepare and review the pack again."); }
    const files = await this.images(owner, approval);
    if (JSON.stringify(files.map(hash)) !== JSON.stringify(approval.hashes)) throw new Error("Sticker images changed after preparation. Prepare and review the pack again.");
    const api = this.deps.api(account);
    const bot = z.object({ id: z.number().int().positive().safe(), is_bot: z.literal(true), username: z.string() }).parse(await api("getMe", {}));
    const currentBotHash = createHash("sha256").update("bunch-telegram-bot-v1\0").update(String(bot.id)).digest("hex");
    if (currentBotHash !== approval.botIdentityHash || bot.username !== approval.botUsername || String(bot.id) !== account.token.split(":", 1)[0]) throw new Error("Telegram bot connection changed after preparation. Prepare the pack again.");
    const base = { name: approval.name, url: `https://t.me/addstickers/${approval.name}`, expectedCount: files.length };
    let priorAttempt: TelegramAttempt | null = null;
    try {
      const existing = stickerSetSchema.parse(await api("getStickerSet", { name: approval.name }));
      priorAttempt = await this.attempts().find(owner, approval.name);
      if (priorAttempt) await this.attempts().setStatus(owner, approval.name, "ACCEPTED");
      return { ...base, status: "existing_unverified" as const, actualCount: existing.stickers.length,
        message: "This name already exists. Nothing was uploaded or changed; its contents have not been matched to this draft. Use a new slug for a revised pack." };
    } catch (error) { if (!(error instanceof TelegramRequestError && error.missingSet)) throw error; }
    const attempt: TelegramAttempt = { ownerId: owner, connectionRevision: approval.connectionRevision, botId: String(bot.id), packName: approval.name,
      titleHash: hash(Buffer.from(approval.title)), contentHash: hash(Buffer.from(JSON.stringify({ stickers: approval.stickers, hashes: approval.hashes }))), status: "STARTED" };
    priorAttempt = await this.attempts().find(owner, approval.name);
    const samePriorContent = priorAttempt && priorAttempt.botId === attempt.botId && priorAttempt.packName === attempt.packName && priorAttempt.titleHash === attempt.titleHash && priorAttempt.contentHash === attempt.contentHash;
    const reserved = priorAttempt?.status === "FAILED" && samePriorContent
      ? await this.attempts().restartFailed(attempt)
      : !priorAttempt && await this.attempts().begin(attempt);
    if (!reserved) {
      return { ...base, status: "uncertain" as const, actualCount: null,
        message: "An earlier request for this exact pack name has no verified completion. Check the same name before retrying; do not create a new name or append stickers." };
    }
    try {
      const accepted = await this.publishBoundary(owner, account, () => api("createNewStickerSet", {
        user_id: account.userId, name: approval.name, title: approval.title, sticker_type: "regular",
        stickers: approval.stickers.map((s, i) => ({ sticker: `attach://sticker_${i}`, format: "static", emoji_list: s.emoji_list, keywords: s.keywords })),
      }, files));
      if (accepted !== true) throw new TelegramRequestError(0, true);
      await this.attempts().setStatus(owner, approval.name, "ACCEPTED");
    } catch (error) {
      if (error instanceof TelegramRequestError && error.uncertain) {
        await this.attempts().setStatus(owner, approval.name, "UNCERTAIN");
        return { ...base, status: "uncertain" as const, actualCount: null,
          message: "Telegram may have created the pack. Check this exact name; do not append stickers or choose a new name to retry." };
      }
      if (error instanceof TelegramConnectionChangedError || error instanceof TelegramRequestError) await this.attempts().setStatus(owner, approval.name, "FAILED");
      else await this.attempts().setStatus(owner, approval.name, "UNCERTAIN");
      throw error;
    }
    try {
      const remote = stickerSetSchema.parse(await api("getStickerSet", { name: approval.name }));
      if (remote.name !== approval.name || remote.title !== approval.title || remote.stickers.length !== files.length) return { ...base, status: "created_unverified" as const, actualCount: remote.stickers.length, message: "Telegram accepted creation, but its returned name, title or count differs. Inspect the pack." };
      await this.attempts().setStatus(owner, approval.name, "VERIFIED");
      return { ...base, status: "created_verified" as const, actualCount: remote.stickers.length, message: "Telegram accepted creation; the resulting pack name, title and sticker count were verified." };
    } catch { return { ...base, status: "created_unverified" as const, actualCount: null, message: "Telegram accepted creation, but the follow-up read failed. Inspect the pack link." }; }
  }
}
