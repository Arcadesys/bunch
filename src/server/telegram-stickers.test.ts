import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFile } from "node:fs/promises";
import { TelegramStickerService, TelegramConnectionChangedError, TelegramRequestError, configuredTelegramAccount, telegramApi, telegramPackName, telegramPackSchema, validateTelegramPng, type TelegramCall } from "./telegram-stickers";
import { registerTelegramStickerTools } from "./telegram-sticker-mcp";
import { TELEGRAM_STICKER_SKILL_TEXT, TELEGRAM_STICKER_SKILL_URI } from "./telegram-sticker-skill";
import { registerSystemSkill } from "./system-skill";

const imageId = "e7c6d939-53b1-4464-a57a-c949157a21ee";
const pack = { title: "Mouse Arcade", slug: "mouse_arcade", stickers: [{ imageId, emoji_list: ["👋"], keywords: ["hello"] }] };
const account = { token: "123456:abcdefghijklmnopqrstuvwxyz", userId: 123 };
const png = () => sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } } }).png().toBuffer();
async function harness() {
  let time = 1000;
  let connectionRevision = 1;
  let bytes: Buffer = await png();
  let existing = false;
  let mode = "normal";
  const calls: { method: string; fields: Record<string, unknown>; files?: Uint8Array[] }[] = [];
  const api: TelegramCall = async (method, fields, files) => {
    calls.push({ method, fields, files });
    if (method === "getMe") return { id: 123456, is_bot: true, username: "BunchStickersBot" };
    if (method === "getChat") return { id: 123, type: "private" };
    if (method === "getStickerSet") {
      if (!existing) throw new TelegramRequestError(400, false, undefined, true);
      if (mode === "readfail") throw new TelegramRequestError(500, true);
      return { name: fields.name, title: pack.title, stickers: mode === "mismatch" ? [] : [{}] };
    }
    if (method === "createNewStickerSet") {
      existing = true;
      if (mode === "timeout") throw new TelegramRequestError(0, true);
      if (mode === "limit") { existing = false; throw new TelegramRequestError(429, false, 12); }
      return true;
    }
    throw new Error("Unexpected method");
  };
  const records = new Map<string, import("./telegram-stickers").TelegramAttempt>();
  const attempts = {
    find: async (ownerId: string, packName: string) => records.get(`${ownerId}:${packName}`) ?? null,
    begin: async (attempt: import("./telegram-stickers").TelegramAttempt) => {
      const key = `${attempt.ownerId}:${attempt.packName}`;
      if (records.has(key)) return false;
      records.set(key, attempt); return true;
    },
    restartFailed: async (attempt: import("./telegram-stickers").TelegramAttempt) => {
      const key = `${attempt.ownerId}:${attempt.packName}`; const prior = records.get(key);
      if (!prior || prior.status !== "FAILED" || prior.botId !== attempt.botId || prior.packName !== attempt.packName || prior.titleHash !== attempt.titleHash || prior.contentHash !== attempt.contentHash) return false;
      records.set(key, { ...attempt, status: "STARTED" }); return true;
    },
    setStatus: async (ownerId: string, packName: string, status: import("./telegram-stickers").TelegramAttemptStatus) => {
      const key = `${ownerId}:${packName}`; const prior = records.get(key); if (prior) records.set(key, { ...prior, status });
    },
  };
  const service = new TelegramStickerService({ account: () => ({ ...account, connectionRevision }), attempts, publishBoundary: async (_owner, _revision, _id, run) => run(), now: () => time, api: () => api,
    image: async (owner, id) => { assert.equal(owner, "owner-a"); assert.equal(id, imageId); return bytes; } });
  return { service, calls, setTime: (n: number) => { time = n; }, setRevision: (n: number) => { connectionRevision = n; }, changeBytes: (b: Buffer) => { bytes = b; }, setExisting: () => { existing = true; }, setMode: (s: string) => { mode = s; } };
}

test("preparation uploads no bytes; actual MCP round trip creates once and reads back across service calls", async () => {
  const h = await harness();
  const server = new McpServer({ name: "bunch-test", version: "1" });
  registerTelegramStickerTools(server, "owner-a", h.service);
  registerSystemSkill(server);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  try {
    const catalog = await client.listTools();
    assert.equal(catalog.tools.find(t => t.name === "publish_telegram_sticker_pack")?.annotations?.openWorldHint, true);
    const prepared = await client.callTool({ name: "prepare_telegram_sticker_pack", arguments: pack });
    assert.ok(!prepared.isError);
    assert.doesNotMatch(JSON.stringify(prepared), /\b123\b|123456/);
    assert.deepEqual(h.calls.map(c => c.method), ["getMe", "getChat"]);
    const token = String((prepared.structuredContent as Record<string, unknown>)?.approvalToken);
    const denied = await client.callTool({ name: "publish_telegram_sticker_pack", arguments: { approvalToken: token, confirmPublicUpload: false } });
    assert.equal(denied.isError, true);
    const result = await client.callTool({ name: "publish_telegram_sticker_pack", arguments: { approvalToken: token, confirmPublicUpload: true } });
    assert.ok(!result.isError, JSON.stringify(result));
    assert.equal((result.structuredContent as Record<string, unknown>)?.status, "created_verified");
    const again = await h.service.publish("owner-a", token, true);
    assert.equal(again.status, "existing_unverified");
    assert.equal(h.calls.filter(c => c.method === "createNewStickerSet").length, 1);
    const write = h.calls.find(c => c.method === "createNewStickerSet")!;
    assert.deepEqual(write.fields.stickers, [{ sticker: "attach://sticker_0", format: "static", emoji_list: ["👋"], keywords: ["hello"] }]);
    assert.equal(write.files?.length, 1);
    assert.ok(!JSON.stringify(result).includes(account.token));
    const skill = await client.readResource({ uri: TELEGRAM_STICKER_SKILL_URI });
    assert.equal((skill.contents[0] as { text: string }).text, TELEGRAM_STICKER_SKILL_TEXT);
  } finally { await client.close(); await server.close(); }
});

test("approval rejects forgery, another owner, expiry, changed account and changed image bytes before Telegram writes", async () => {
  const h = await harness();
  const prepared = await h.service.prepare("owner-a", pack);
  await assert.rejects(h.service.publish("owner-a", prepared.approvalToken + "x", true), /invalid or expired/);
  await assert.rejects(h.service.publish("owner-b", prepared.approvalToken, true), /invalid or expired/);
  await assert.rejects(h.service.publish("owner-a", prepared.approvalToken, false), /Explicit approval/);
  h.setTime(prepared.expiresAt);
  await assert.rejects(h.service.publish("owner-a", prepared.approvalToken, true), /invalid or expired/);
  h.setTime(1000);
  const changedAccount = new TelegramStickerService({ account: () => ({ ...account, userId: 456 }), now: () => 1000, image: async () => { throw new Error("must not read"); }, api: () => { throw new Error("must not call"); } });
  await assert.rejects(changedAccount.publish("owner-a", prepared.approvalToken, true), /invalid or expired/);
  h.changeBytes(await sharp(await png()).flop().png({ compressionLevel: 0 }).toBuffer());
  // An overlarge changed image is rejected before upload as well.
  await assert.rejects(h.service.publish("owner-a", prepared.approvalToken, true), /512 KB|changed/);
  assert.equal(h.calls.filter(c => c.method === "createNewStickerSet").length, 0);
});

test("same-size valid image change requires new review", async () => {
  const h = await harness(); const prepared = await h.service.prepare("owner-a", pack);
  h.changeBytes(await sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 0.5 } } }).png().toBuffer());
  await assert.rejects(h.service.publish("owner-a", prepared.approvalToken, true), /changed/);
});

test("remote failures distinguish ambiguous writes, accepted creation and rate limits without blind retries", async () => {
  for (const [mode, status] of [["timeout", "uncertain"], ["readfail", "created_unverified"], ["mismatch", "created_unverified"]]) {
    const h = await harness(); const prepared = await h.service.prepare("owner-a", pack); h.setMode(mode);
    assert.equal((await h.service.publish("owner-a", prepared.approvalToken, true)).status, status);
    assert.equal(h.calls.filter(c => c.method === "createNewStickerSet").length, 1);
    if (mode === "timeout") {
      assert.equal((await h.service.publish("owner-a", prepared.approvalToken, true)).status, "existing_unverified");
      assert.equal(h.calls.filter(c => c.method === "createNewStickerSet").length, 1);
    }
  }
  const h = await harness(); const prepared = await h.service.prepare("owner-a", pack); h.setMode("limit");
  await assert.rejects(h.service.publish("owner-a", prepared.approvalToken, true), /12 seconds/);
  assert.equal(h.calls.filter(c => c.method === "createNewStickerSet").length, 1);
  h.setRevision(2);
  h.setMode("normal");
  const relinkedApproval = await h.service.prepare("owner-a", pack);
  assert.equal((await h.service.publish("owner-a", relinkedApproval.approvalToken, true)).status, "created_verified");
  assert.equal(h.calls.filter(c => c.method === "createNewStickerSet").length, 2);
});

test("a disconnect completed before create dispatch prevents a stale approval from reaching Telegram", async () => {
  const h = await harness(); const prepared = await h.service.prepare("owner-a", pack);
  let linked = true; let writes = 0;
  const guarded = new TelegramStickerService({
    account: () => ({ ...account, connectionRevision: 1 }), image: async () => await png(),
    api: () => async method => {
      if (method === "getMe") return { id: 123456, is_bot: true, username: "BunchStickersBot" };
      if (method === "getChat") return { id: 123, type: "private" };
      if (method === "getStickerSet") throw new TelegramRequestError(400, false, undefined, true);
      if (method === "createNewStickerSet") { writes++; return true; }
      throw new Error("unexpected");
    },
    attempts: { find: async () => null, begin: async () => true, restartFailed: async () => false, setStatus: async () => {} }, now: () => 1000,
    publishBoundary: async (_owner, revision, userId, run) => {
      if (!linked || revision !== 0 || userId !== 123) throw new TelegramConnectionChangedError();
      return run();
    },
  });
  linked = false;
  await assert.rejects(guarded.publish("owner-a", prepared.approvalToken, true), /connection changed before publication/);
  assert.equal(writes, 0);
});

test("manifest, account and actual PNG decoder validation", async () => {
  assert.throws(() => telegramPackSchema.parse({ ...pack, stickers: [...pack.stickers, ...pack.stickers] }));
  assert.throws(() => telegramPackSchema.parse({ ...pack, slug: "bad__slug" }));
  assert.throws(() => telegramPackSchema.parse({ ...pack, stickers: [{ ...pack.stickers[0], keywords: ["x".repeat(65)] }] }));
  const oldToken = process.env.TELEGRAM_BOT_TOKEN; const oldMap = process.env.TELEGRAM_STICKER_ACCOUNTS;
  delete process.env.TELEGRAM_BOT_TOKEN; process.env.TELEGRAM_STICKER_ACCOUNTS = JSON.stringify({ owner: account });
  try {
    await assert.rejects(configuredTelegramAccount("owner"), /not configured/);
    await assert.rejects(configuredTelegramAccount("toString"), /not configured/);
  } finally {
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldMap === undefined) delete process.env.TELEGRAM_STICKER_ACCOUNTS; else process.env.TELEGRAM_STICKER_ACCOUNTS = oldMap;
  }
  const safeName = telegramPackName("x".repeat(32), "abcdef0123456789", "LongNameForStickerPublishingBot");
  assert.ok(safeName.length <= 64);
  assert.doesNotMatch(safeName, /9007199254740991/);
  await validateTelegramPng(await png());
  await assert.rejects(validateTelegramPng(Buffer.from("invalid")));
  await assert.rejects(validateTelegramPng((await png()).subarray(0, 60)));
  await assert.rejects(validateTelegramPng(await sharp({ create: { width: 512, height: 512, channels: 4, background: "white" } }).png().toBuffer()));
});

test("HTTP multipart mapping and credential-safe failures", async () => {
  const bytes = await png();
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(String(url), `https://api.telegram.org/bot${account.token}/createNewStickerSet`);
    assert.equal(options?.redirect, "error");
    const form = options?.body as FormData;
    assert.equal(form.get("user_id"), "123");
    assert.deepEqual(Buffer.from(await (form.get("sticker_0") as Blob).arrayBuffer()), bytes);
    return Response.json({ ok: true, result: true });
  };
  assert.equal(await telegramApi(account, fetcher)("createNewStickerSet", { user_id: 123 }, [bytes]), true);
  const leak = `https://api.telegram.org/bot${account.token}/method`;
  await assert.rejects(telegramApi(account, async () => { throw new Error(leak); })("getMe", {}), e => !String(e).includes(account.token));
  await assert.rejects(telegramApi(account, async () => Response.json({ ok: false, error_code: 400, description: leak }, { status: 400 }))("getMe", {}), e => !String(e).includes(account.token));
  await assert.rejects(telegramApi(account, async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: leak } }, { status: 429 }))("getMe", {}), e => !String(e).includes(account.token));
  await assert.rejects(telegramApi(account, fetcher)("sendMessage", {}), /Unsupported/);
});

test("published skill copies match the MCP resource", async () => {
  for (const path of ["../../skills/upload-telegram-stickers/SKILL.md", "../../plugins/bunch/skills/upload-telegram-stickers/SKILL.md"]) {
    assert.equal(await readFile(new URL(path, import.meta.url), "utf8"), TELEGRAM_STICKER_SKILL_TEXT);
  }
});
