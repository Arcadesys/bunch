import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getDatabasePool } from "@/db/client";
import { SystemError } from "@/server/system-error";
import { TELEGRAM_LINK_ENV, type TelegramBotAccess, type TelegramConnectionMetadata, type TelegramLinkState } from "@/domain/telegram-link";

const ISSUER = "https://oauth.telegram.org";
const AUTH_ENDPOINT = `${ISSUER}/auth`;
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
const SESSION_COOKIE = "bunch_telegram_link_session";
const TRANSACTION_MS = 10 * 60_000;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const opaque = (bytes = 32) => randomBytes(bytes).toString("base64url");

export class TelegramLinkError extends Error {
  constructor(readonly code: string, message: string, readonly status: number = 400) { super(message); }
}

type TelegramConfig = { botToken: string; clientId: string; clientSecret: string; botId: string; callbackUrl: string };
function config(): TelegramConfig | null {
  const botToken = process.env[TELEGRAM_LINK_ENV.botToken];
  const clientId = process.env[TELEGRAM_LINK_ENV.oidcClientId];
  const clientSecret = process.env[TELEGRAM_LINK_ENV.oidcClientSecret];
  const origin = process.env.SYSTEM_PUBLIC_ORIGIN;
  const match = botToken?.match(/^(\d+):[A-Za-z0-9_-]{20,}$/);
  if (!botToken || !clientId || !clientSecret || !origin || !match || match[1] !== clientId || !/^\d+$/.test(clientId)) return null;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") return null;
    return { botToken, clientId, clientSecret, botId: match[1], callbackUrl: new URL("/api/v1/account/telegram/callback", parsed).toString() };
  } catch { return null; }
}

export function telegramLinkEnabled() { return config() !== null; }
export function telegramSessionCookieName() { return SESSION_COOKIE; }
export function readTelegramSession(request: Request) {
  return request.headers.get("cookie")?.split(/;\s*/).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? null;
}
export function telegramSessionSetCookie(value: string) {
  return `${SESSION_COOKIE}=${value}; Path=/api/v1/account/telegram; Max-Age=1800; HttpOnly; Secure; SameSite=Lax`;
}

async function cleanup(pool = getDatabasePool()) {
  await Promise.all([
    pool.query("delete from telegram_link_transaction where expires_at < now() or status in ('CONFIRMED','FAILED') and created_at < now() - interval '1 day'"),
    pool.query("delete from telegram_link_intent where expires_at < now() or consumed_at is not null"),
    pool.query("delete from telegram_link_rate where window_start < now() - interval '2 days'"),
  ]);
}

async function rateLimit(ownerId: string, bucket: "status" | "start" | "confirm" | "recheck" | "disconnect" | "callback", limit: number) {
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<{ count: number }>(
      `insert into telegram_link_rate(rate_key,bucket,window_start,count) values($1,$2,date_trunc('minute',now()),1)
       on conflict(rate_key,bucket,window_start) do update set count=telegram_link_rate.count+1 returning count`,
      [ownerId, bucket],
    );
    const global = await client.query<{ count: number }>(
      `insert into telegram_link_rate(rate_key,bucket,window_start,count) values('*',$1,date_trunc('minute',now()),1)
       on conflict(rate_key,bucket,window_start) do update set count=telegram_link_rate.count+1 returning count`,
      [`global:${bucket}`],
    );
    await client.query("commit");
    const globalLimit = bucket === "start" ? 100 : 1000;
    if (Number(result.rows[0]?.count) > limit || Number(global.rows[0]?.count) > globalLimit) throw new TelegramLinkError("rate_limited", "Too many Telegram account requests. Try again shortly.", 429);
  } catch (error) {
    await client.query("rollback");
    if (error instanceof TelegramLinkError) throw error;
    throw safeUnavailable();
  } finally { client.release(); }
}

async function lockOwner(client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, ownerId: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [ownerId]);
}

function safeUnavailable() { return new TelegramLinkError("temporarily_unavailable", "Telegram account linking is temporarily unavailable.", 503); }

async function botIdentity(cfg: TelegramConfig) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getMe`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(8_000), redirect: "error" });
    const body = await response.json() as { ok?: boolean; result?: { id?: number; is_bot?: boolean; username?: string } };
    if (!response.ok || body.ok !== true || body.result?.is_bot !== true || String(body.result.id) !== cfg.botId || !body.result.username) throw new Error("invalid bot identity");
    return { id: String(body.result.id), username: body.result.username };
  } catch { throw safeUnavailable(); }
}

export async function createTelegramLinkIntent(ownerId: string) {
  const token = opaque();
  try {
    await cleanup();
    await getDatabasePool().query("insert into telegram_link_intent(token_hash,owner_id,expires_at) values($1,$2,now()+interval '15 minutes')", [sha(token), ownerId]);
    return token;
  } catch { throw safeUnavailable(); }
}

function statusRow(row: { display_name: string | null; username: string | null; connected_at: Date | string; connection_revision: number }) : TelegramConnectionMetadata {
  return { displayName: row.display_name, username: row.username, connectedAt: new Date(row.connected_at).toISOString(), revision: row.connection_revision };
}

export async function getTelegramLinkStatus(ownerId: string, browserSession: string | null, confirmationId?: string | null) {
  const cfg = config();
  await cleanup();
  await rateLimit(ownerId, "status", 120);
  const pool = getDatabasePool();
  if (confirmationId) {
    if (!browserSession) throw new TelegramLinkError("session_mismatch", "Return in the browser that started Telegram linking.", 409);
    const pending = (await pool.query<{ owner_id: string; session_hash: string; status: string; display_name: string | null; username: string | null; expires_at: Date }>(
      "select owner_id,session_hash,status,display_name,username,expires_at from telegram_link_transaction where confirmation_hash=$1", [sha(confirmationId)])).rows[0];
    if (!pending || pending.owner_id !== ownerId || !safeEqual(pending.session_hash, sha(browserSession))) throw new TelegramLinkError("confirmation_expired", "This Telegram confirmation has expired. Start again.", 410);
    if (pending.status !== "AWAITING_CONFIRMATION" || pending.expires_at.getTime() <= Date.now()) throw new TelegramLinkError("confirmation_expired", "This Telegram confirmation has expired. Start again.", 410);
    return { state: "awaiting_confirmation" as const, pending: { confirmationId, displayName: pending.display_name, username: pending.username, expiresAt: pending.expires_at.toISOString() } };
  }
  const connection = (await pool.query<{ display_name: string | null; username: string | null; connected_at: Date; connection_revision: number; bot_access: boolean }>(
    "select display_name,username,connected_at,connection_revision,bot_access from telegram_connection where owner_id=$1", [ownerId])).rows[0];
  if (connection) {
    const botAccess: TelegramBotAccess = !cfg ? "unknown" : connection.bot_access ? "granted" : "missing";
    const username = cfg && !connection.bot_access ? (await botIdentity(cfg)).username : null;
    return { state: !cfg ? "connected" as const : connection.bot_access ? "connected" as const : "bot_access_required" as const,
      connection: statusRow(connection), botAccess, ...(username ? { botStartUrl: `https://t.me/${username}?start=bunch` } : {}) };
  }
  if (!cfg) return { state: "disabled" as const };
  // The raw confirmation handle is never stored in the database. The callback
  // must carry it into this owner-and-session-bound status lookup.
  return { state: "disconnected" as const };
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function safeJoseDiagnostic(error: unknown): { category: string; claim?: string } | null {
  if (!(error instanceof Error)) return null;
  const code = (error as Error & { code?: unknown }).code;
  const categories: Record<string, string> = {
    ERR_JWS_SIGNATURE_VERIFICATION_FAILED: "jose_signature_invalid",
    ERR_JOSE_ALG_NOT_ALLOWED: "jose_algorithm_not_allowed",
    ERR_JWT_CLAIM_VALIDATION_FAILED: "jose_claim_invalid",
    ERR_JWT_EXPIRED: "jose_token_expired",
    ERR_JWT_INVALID: "jose_token_invalid",
    ERR_JWS_INVALID: "jose_token_invalid",
    ERR_JWKS_NO_MATCHING_KEY: "jose_key_not_found",
    ERR_JWKS_MULTIPLE_MATCHING_KEYS: "jose_key_ambiguous",
    ERR_JWKS_TIMEOUT: "jose_key_timeout",
    ERR_JWK_INVALID: "jose_key_invalid",
  };
  if (typeof code !== "string" || !Object.hasOwn(categories, code)) return null;
  const claim = (error as Error & { claim?: unknown }).claim;
  const safeClaims = ["iss", "aud", "exp", "iat", "sub", "nonce"];
  return { category: categories[code], ...(code === "ERR_JWT_CLAIM_VALIDATION_FAILED" && typeof claim === "string" && safeClaims.includes(claim) ? { claim } : {}) };
}

export async function startTelegramLink(ownerId: string, browserSession: string | null, intent: string | null) {
  const cfg = config();
  if (!cfg) return { state: "disabled" as const };
  await cleanup();
  await rateLimit(ownerId, "start", 8);
  const bot = await botIdentity(cfg);
  if (bot.id !== cfg.clientId) throw safeUnavailable();
  if (intent) {
    const consumed = await getDatabasePool().query("update telegram_link_intent set consumed_at=now() where token_hash=$1 and owner_id=$2 and consumed_at is null and expires_at>now() returning token_hash", [sha(intent), ownerId]);
    if (!consumed.rowCount) throw new TelegramLinkError("session_mismatch", "This connection request is invalid or expired.", 409);
  }
  const session = browserSession ?? opaque();
  const state = opaque();
  const nonce = opaque();
  const verifier = opaque(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  try {
    await getDatabasePool().query(
      "insert into telegram_link_transaction(state_hash,owner_id,session_hash,nonce,code_verifier,intent_hash,status,expires_at) values($1,$2,$3,$4,$5,$6,'PENDING',now()+interval '10 minutes')",
      [sha(state), ownerId, sha(session), nonce, verifier, intent ? sha(intent) : null],
    );
  } catch { throw safeUnavailable(); }
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.callbackUrl, response_type: "code", scope: "openid profile telegram:bot_access", state, nonce, code_challenge: challenge, code_challenge_method: "S256" }).toString();
  return { session, createdSession: !browserSession, authorizationUrl: url.toString(), expiresAt: new Date(Date.now() + TRANSACTION_MS).toISOString() };
}

function accountPage(origin: string, key: "telegram_confirmation" | "telegram_error", value: string) {
  const url = new URL("/account", origin); url.searchParams.set(key, value);
  return Response.redirect(url, 303);
}

export async function callbackTelegramLink(request: Request, ownerId: string | null, browserSession: string | null) {
  const url = new URL(request.url);
  const origin = process.env.SYSTEM_PUBLIC_ORIGIN ?? url.origin;
  const safeError = (code: string) => accountPage(origin, "telegram_error", code);
  try { await rateLimit(ownerId ?? "invalid-callback", "callback", 20); } catch { return safeError("rate_limited"); }
  const state = url.searchParams.get("state");
  if (!state || !browserSession) return safeError("session_mismatch");
  const pool = getDatabasePool();
  let transaction: { owner_id: string; session_hash: string; nonce: string; code_verifier: string; status: string; expires_at: Date } | undefined;
  try {
    await cleanup(pool);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const found = await client.query<{ owner_id: string; session_hash: string; nonce: string; code_verifier: string; status: string; expires_at: Date }>("select owner_id,session_hash,nonce,code_verifier,status,expires_at from telegram_link_transaction where state_hash=$1 for update", [sha(state)]);
      transaction = found.rows[0];
      if (!transaction) { await client.query("rollback"); return safeError("transaction_expired"); }
      if (transaction.status !== "PENDING") { await client.query("rollback"); return safeError("transaction_replayed"); }
      if (transaction.expires_at.getTime() <= Date.now()) { await client.query("update telegram_link_transaction set status='FAILED',code_verifier='' where state_hash=$1", [sha(state)]); await client.query("commit"); return safeError("transaction_expired"); }
      if (!safeEqual(transaction.session_hash, sha(browserSession)) || !ownerId || transaction.owner_id !== ownerId) {
        await client.query("update telegram_link_transaction set status='FAILED',code_verifier='' where state_hash=$1", [sha(state)]); await client.query("commit"); return safeError("session_mismatch");
      }
      await client.query("update telegram_link_transaction set status='EXCHANGING',code_verifier='' where state_hash=$1", [sha(state)]);
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  } catch { return safeError("temporarily_unavailable"); }
  if (url.searchParams.has("error")) {
    try { await pool.query("update telegram_link_transaction set status='FAILED',nonce='',code_verifier='' where state_hash=$1 and status='EXCHANGING'", [sha(state)]); } catch { /* keep provider errors private */ }
    return safeError("authorization_cancelled");
  }
  const code = url.searchParams.get("code");
  const cfg = config();
  if (!code || !cfg) return safeError("invalid_request");
  let failureStage = "token_exchange_request";
  let failureCategory = "unexpected_failure";
  let failureClaim: string | undefined;
  let providerStatus: number | undefined;
  try {
    // The verifier was read while the transaction row lock was held; the stored copy was erased before leaving that transaction.
    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: cfg.callbackUrl, client_id: cfg.clientId, code_verifier: transaction.code_verifier });
    const tokenResponse = await fetch(TOKEN_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}` }, body: form, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
    failureStage = "token_exchange_response";
    if (!tokenResponse.ok) providerStatus = tokenResponse.status;
    const tokenBody = await tokenResponse.json() as { id_token?: string };
    await pool.query("update telegram_link_transaction set code_verifier='' where state_hash=$1", [sha(state)]);
    if (!tokenResponse.ok) { failureCategory = "provider_token_rejected"; throw new Error("token exchange failed"); }
    if (!tokenBody.id_token) { failureCategory = "provider_id_token_missing"; throw new Error("token response invalid"); }
    providerStatus = undefined;
    failureStage = "oidc_token_verification";
    let verified;
    try { verified = await jwtVerify(tokenBody.id_token, JWKS, { issuer: ISSUER, audience: cfg.clientId, algorithms: ["RS256"], clockTolerance: 5, requiredClaims: ["exp", "iat", "sub", "nonce"] }); }
    catch (error) {
      const diagnostic = safeJoseDiagnostic(error);
      if (diagnostic) { failureCategory = diagnostic.category; failureClaim = diagnostic.claim; }
      throw error;
    }
    const claims = verified.payload as typeof verified.payload & { id?: number; name?: string; preferred_username?: string; nonce?: string };
    failureStage = "oidc_claim_validation";
    const nowSeconds = Math.floor(Date.now() / 1000);
    const invalidClaim = typeof claims.iat !== "number" || !Number.isFinite(claims.iat) || claims.iat > nowSeconds + 30 ? "iat" :
      typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= claims.iat ? "exp" :
      !claims.nonce || !safeEqual(String(claims.nonce), transaction.nonce) ? "nonce" :
      typeof claims.sub !== "string" || !claims.sub ? "sub" :
      typeof claims.id !== "number" || !Number.isSafeInteger(claims.id) || claims.id <= 0 ? "id" : null;
    if (invalidClaim) { failureCategory = "claim_validation_failed"; failureClaim = invalidClaim === "id" ? undefined : invalidClaim; throw new Error("identity claims invalid"); }
    failureStage = "bot_identity_verification";
    failureCategory = "bot_identity_unavailable";
    const bot = await botIdentity(cfg);
    let botAccess = false;
    try {
      const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getChat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: claims.id }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
      const body = await response.json() as { ok?: boolean; result?: { id?: number; type?: string } };
      botAccess = response.ok && body.ok === true && body.result?.id === claims.id && body.result?.type === "private";
    } catch { /* no provider text or error objects escape */ }
    if (transaction.owner_id !== ownerId) return safeError("session_mismatch");
    const confirmation = opaque();
    failureStage = "confirmation_persistence";
    failureCategory = "confirmation_persistence_failed";
    const finalize = await pool.connect();
    let result;
    try {
      await finalize.query("begin");
      await lockOwner(finalize, ownerId);
      result = await finalize.query(
        `update telegram_link_transaction set confirmation_hash=$2,status='AWAITING_CONFIRMATION',telegram_issuer=$3,telegram_subject=$4,telegram_user_id=$5,display_name=$6,username=$7,bot_access=$8,expires_at=now()+interval '10 minutes'
         where state_hash=$1 and owner_id=$9 and status='EXCHANGING' and code_verifier='' returning state_hash`,
        [sha(state), sha(confirmation), ISSUER, claims.sub, String(claims.id), typeof claims.name === "string" ? claims.name.slice(0, 256) : null,
          typeof claims.preferred_username === "string" ? claims.preferred_username.slice(0, 64) : null, botAccess, ownerId],
      );
      await finalize.query("commit");
    } catch (error) { await finalize.query("rollback"); throw error; } finally { finalize.release(); }
    if (!result.rowCount) return safeError("transaction_replayed");
    return accountPage(origin, "telegram_confirmation", confirmation);
  } catch {
    // Keep provider errors, token material, claims, and account identifiers out of logs.
    console.error("[telegram-link] callback failed", { stage: failureStage, category: failureCategory, ...(failureClaim ? { claim: failureClaim } : {}), ...(providerStatus !== undefined ? { providerStatus } : {}) });
    try { await pool.query("update telegram_link_transaction set status='FAILED',code_verifier='',nonce='' where state_hash=$1 and status='EXCHANGING'", [sha(state)]); } catch { /* remain generic */ }
    return safeError("telegram_identity_invalid");
  }
}

export async function confirmTelegramLink(ownerId: string, browserSession: string | null, confirmationId: unknown) {
  const cfg = config();
  if (!cfg) throw new TelegramLinkError("disabled", "Telegram account linking is not configured.", 503);
  if (typeof confirmationId !== "string" || confirmationId.length < 20 || confirmationId.length > 128) throw new TelegramLinkError("invalid_request", "Choose the Telegram account shown for confirmation.", 400);
  if (!browserSession) throw new TelegramLinkError("session_mismatch", "Return in the browser that started Telegram linking.", 409);
  await cleanup(); await rateLimit(ownerId, "confirm", 12);
  const pool = getDatabasePool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await lockOwner(client, ownerId);
    const pending = (await client.query<{ owner_id: string; session_hash: string; status: string; expires_at: Date; telegram_issuer: string; telegram_subject: string; telegram_user_id: string; display_name: string | null; username: string | null; bot_access: boolean }>(
      "select owner_id,session_hash,status,expires_at,telegram_issuer,telegram_subject,telegram_user_id,display_name,username,bot_access from telegram_link_transaction where confirmation_hash=$1 for update", [sha(confirmationId)])).rows[0];
    if (!pending || pending.owner_id !== ownerId || !safeEqual(pending.session_hash, sha(browserSession))) throw new TelegramLinkError("session_mismatch", "This confirmation belongs to another Bunch account or browser.", 409);
    if (pending.status !== "AWAITING_CONFIRMATION") throw new TelegramLinkError("transaction_replayed", "This Telegram confirmation has already been used.", 409);
    if (pending.expires_at.getTime() <= Date.now()) throw new TelegramLinkError("confirmation_expired", "This Telegram confirmation has expired. Start again.", 410);
    const old = (await client.query<{ telegram_user_id: string }>("select telegram_user_id from telegram_connection where owner_id=$1 for update", [ownerId])).rows[0];
    if (old && old.telegram_user_id !== pending.telegram_user_id) throw new TelegramLinkError("telegram_account_conflict", "Disconnect the current Telegram account before connecting a different one.", 409);
    await client.query("insert into app_user(id,google_subject) values($1,$1) on conflict do nothing", [ownerId]);
    const epoch = (await client.query<{ revision: number }>("insert into telegram_connection_epoch(owner_id,revision) values($1,1) on conflict(owner_id) do update set revision=telegram_connection_epoch.revision+1 returning revision", [ownerId])).rows[0].revision;
    await client.query(
      `insert into telegram_connection(owner_id,issuer,subject,telegram_user_id,display_name,username,bot_access,connection_revision,connected_at,updated_at)
       values($1,$2,$3,$4,$5,$6,$7,$8,now(),now())
       on conflict(owner_id) do update set issuer=excluded.issuer,subject=excluded.subject,telegram_user_id=excluded.telegram_user_id,display_name=excluded.display_name,username=excluded.username,bot_access=excluded.bot_access,connection_revision=excluded.connection_revision,connected_at=now(),updated_at=now()`,
      [ownerId,pending.telegram_issuer,pending.telegram_subject,pending.telegram_user_id,pending.display_name,pending.username,pending.bot_access,epoch],
    );
    await client.query("update telegram_link_transaction set status='CONFIRMED',confirmed_at=now(),nonce='',code_verifier='' where confirmation_hash=$1", [sha(confirmationId)]);
    await client.query("commit");
    const connection = { displayName: pending.display_name, username: pending.username, connectedAt: new Date().toISOString(), revision: epoch };
    return { state: pending.bot_access ? "connected" as const : "bot_access_required" as const, connection, botAccess: pending.bot_access ? "granted" as const : "missing" as const,
      ...(pending.bot_access ? {} : { botStartUrl: `https://t.me/${(await botIdentity(cfg)).username}?start=bunch` }) };
  } catch (error) {
    await client.query("rollback");
    if (error instanceof TelegramLinkError) throw error;
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "23505") throw new TelegramLinkError("telegram_account_conflict", "This Telegram account is already connected to another Bunch account.", 409);
    throw safeUnavailable();
  } finally { client.release(); }
}

export async function recheckTelegramLink(ownerId: string) {
  const cfg = config(); if (!cfg) throw new TelegramLinkError("disabled", "Telegram account linking is not configured.", 503);
  await rateLimit(ownerId, "recheck", 8);
  const row = (await getDatabasePool().query<{ telegram_user_id: string; display_name: string | null; username: string | null; connected_at: Date; connection_revision: number }>("select telegram_user_id,display_name,username,connected_at,connection_revision from telegram_connection where owner_id=$1", [ownerId])).rows[0];
  if (!row) return { state: "disconnected" as const };
  const bot = await botIdentity(cfg);
  let access = false;
  try {
    const response = await fetch(`https://api.telegram.org/bot${cfg.botToken}/getChat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: row.telegram_user_id }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
    const body = await response.json() as { ok?: boolean; result?: { id?: number; type?: string } };
    access = response.ok && body.ok === true && String(body.result?.id) === row.telegram_user_id && body.result?.type === "private";
  } catch { throw safeUnavailable(); }
  const updated = await getDatabasePool().query("update telegram_connection set bot_access=$2,updated_at=now() where owner_id=$1 and connection_revision=$3", [ownerId, access, row.connection_revision]);
  if (!updated.rowCount) throw new TelegramLinkError("session_mismatch", "The Telegram connection changed during this check. Reload the account settings.", 409);
  return { state: access ? "connected" as const : "bot_access_required" as const, connection: statusRow(row), botAccess: access ? "granted" as const : "missing" as const, ...(access ? {} : { botStartUrl: `https://t.me/${bot.username}?start=bunch` }) };
}

export async function disconnectTelegramLink(ownerId: string) {
  await rateLimit(ownerId, "disconnect", 8);
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    await lockOwner(client, ownerId);
    await client.query("delete from telegram_connection where owner_id=$1", [ownerId]);
    await client.query("update telegram_link_transaction set status='FAILED',confirmation_hash=null,nonce='',code_verifier='' where owner_id=$1 and status in ('PENDING','EXCHANGING','AWAITING_CONFIRMATION')", [ownerId]);
    await client.query("commit");
  } catch { await client.query("rollback"); throw safeUnavailable(); }
  finally { client.release(); }
  return { state: "disconnected" as const };
}

export function telegramLinkErrorResponse(error: unknown) {
  let e: TelegramLinkError;
  if (error instanceof TelegramLinkError) e = error;
  else if (error instanceof SystemError) {
    const code = error.code === "UNAUTHORIZED" ? "unauthenticated" : error.code === "FORBIDDEN" ? "not_eligible" : error.code === "RATE_LIMITED" ? "rate_limited" : "temporarily_unavailable";
    e = new TelegramLinkError(code, error.userMessage, error.code === "UNAUTHORIZED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "RATE_LIMITED" ? 429 : 503);
  } else e = new TelegramLinkError("temporarily_unavailable", "Telegram account linking is temporarily unavailable.", 503);
  return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { "Cache-Control": "private, no-store" } });
}

export async function purgeExpiredTelegramLinkMaterial() {
  await cleanup();
}
