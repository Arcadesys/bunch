import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { getDatabasePool } from "@/db/client";
import { requireStrictSameOriginJson } from "@/server/http-api";
import { PilotService } from "@/server/pilot-service";
import {
  callbackTelegramLink, confirmTelegramLink, createTelegramLinkIntent, disconnectTelegramLink,
  getTelegramLinkStatus, readTelegramSession, recheckTelegramLink, startTelegramLink, TelegramLinkError,
} from "@/server/telegram-link";

const localTestUrl = process.env.TEST_DATABASE_URL;
const safeLocalTestUrl = (() => {
  if (!localTestUrl) return null;
  const parsed = new URL(localTestUrl);
  const name = parsed.pathname.slice(1);
  if (!name.endsWith("_test") || !["localhost", "127.0.0.1"].includes(parsed.hostname)) return null;
  return localTestUrl;
})();
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};
function assertConfiguredStart(value: Awaited<ReturnType<typeof startTelegramLink>>): asserts value is { session: string; createdSession: boolean; authorizationUrl: string; expiresAt: string } {
  assert.ok("authorizationUrl" in value, "synthetic Telegram configuration should enable linking");
}

test("strict same-origin account mutations require an explicit Origin and JSON", () => {
  assert.throws(() => requireStrictSameOriginJson(new Request("https://bunch.test/api/v1/account/telegram/start", { method: "POST", headers: { "content-type": "application/json" } })), /Bunch website/);
  assert.throws(() => requireStrictSameOriginJson(new Request("https://bunch.test/api/v1/account/telegram/start", { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" } })), /Bunch website/);
  assert.throws(() => requireStrictSameOriginJson(new Request("https://bunch.test/api/v1/account/telegram/start", { method: "POST", headers: { origin: "https://bunch.test", "content-type": "text/plain" } })), /JSON/);
  assert.doesNotThrow(() => requireStrictSameOriginJson(new Request("https://bunch.test/api/v1/account/telegram/start", { method: "POST", headers: { origin: "https://bunch.test", "content-type": "application/json" } })));
});

test("Telegram linking validates OIDC, binds owner and browser, serializes unlink, and exports safe metadata", { skip: !safeLocalTestUrl }, async () => {
  process.env.DATABASE_URL = safeLocalTestUrl!;
  const globals = globalThis as typeof globalThis & { systemPool?: ReturnType<typeof getDatabasePool> };
  delete globals.systemPool;
  const pool = getDatabasePool();
  const ownerA = `auth0:telegram-test-a-${Date.now()}`;
  const ownerB = `${ownerA}-b`, ownerC = `${ownerA}-c`, ownerD = `${ownerA}-d`, ownerE = `${ownerA}-e`;
  const priorEnv = {
    origin: process.env.SYSTEM_PUBLIC_ORIGIN,
    bot: process.env.TELEGRAM_BOT_TOKEN,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET,
  };
  const priorFetch = globalThis.fetch;
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: "telegram-link-test", alg: "RS256", use: "sig" });
  const nonceByState = new Map<string, string>();
  const payloadByCode = new Map<string, { sub: string; id: number; nonce: string; audience?: string; expires?: number; missingExp?: boolean; gate?: ReturnType<typeof deferred> }>();
  let allowBotStart = true;
  process.env.SYSTEM_PUBLIC_ORIGIN = "https://bunch.example.test";
  process.env.TELEGRAM_BOT_TOKEN = "123456:synthetic_test_token_never_live_000000";
  process.env.TELEGRAM_OIDC_CLIENT_ID = "123456";
  process.env.TELEGRAM_OIDC_CLIENT_SECRET = "synthetic-client-secret";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://oauth.telegram.org/.well-known/jwks.json") return Response.json({ keys: [jwk] });
    if (url === "https://oauth.telegram.org/token") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const code = form.get("code") ?? "";
      const claims = payloadByCode.get(code);
      if (!claims) return Response.json({ error: "invalid_grant" }, { status: 400 });
      if (claims.gate) { claims.gate.resolve(); await claims.gate.promise; }
      const now = Math.floor(Date.now() / 1000);
      let token = new SignJWT({ id: claims.id, nonce: claims.nonce, name: "Linked account", preferred_username: "linked_user" })
        .setProtectedHeader({ alg: "RS256", kid: "telegram-link-test" })
        .setIssuer("https://oauth.telegram.org").setAudience(claims.audience ?? "123456").setSubject(claims.sub)
        .setIssuedAt(now);
      if (!claims.missingExp) token = token.setExpirationTime(claims.expires ?? now + 300);
      const idToken = await token.sign(privateKey);
      return Response.json({ id_token: idToken });
    }
    if (url.endsWith("/getMe")) return Response.json({ ok: true, result: { id: 123456, is_bot: true, username: "BunchStickersBot" } });
    if (url.endsWith("/getChat")) {
      const fields = JSON.parse(String(init?.body ?? "{}")) as { chat_id?: number };
      return allowBotStart ? Response.json({ ok: true, result: { id: fields.chat_id, type: "private" } }) : Response.json({ ok: false, error_code: 400 }, { status: 400 });
    }
    throw new Error("Unexpected synthetic provider request");
  }) as typeof fetch;
  const providerFetch = globalThis.fetch;

  function credentials(stateUrl: string, code: string, values: { sub: string; id: number; audience?: string; expires?: number; missingExp?: boolean; gate?: ReturnType<typeof deferred> }) {
    const auth = new URL(stateUrl);
    const state = auth.searchParams.get("state")!;
    const nonce = auth.searchParams.get("nonce")!;
    nonceByState.set(state, nonce);
    payloadByCode.set(code, { ...values, nonce });
    return { state, nonce, callbackUrl: `https://bunch.example.test/api/v1/account/telegram/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}` };
  }
  async function authorized(ownerId: string, claims: { sub: string; id: number }) {
    const start = await startTelegramLink(ownerId, null, null);
    assertConfiguredStart(start);
    const session = start.session;
    const input = credentials(start.authorizationUrl, `code-${claims.sub}`, claims);
    const callback = await callbackTelegramLink(new Request(input.callbackUrl), ownerId, session);
    const redirect = new URL(callback.headers.get("location")!);
    const confirmationId = redirect.searchParams.get("telegram_confirmation")!;
    assert.equal(redirect.searchParams.has("code"), false);
    assert.equal(redirect.searchParams.has("state"), false);
    return { session, confirmationId, callback, start };
  }

  try {
    await pool.query("delete from telegram_link_transaction where owner_id like 'auth0:telegram-test-%'");
    await pool.query("delete from telegram_link_intent where owner_id like 'auth0:telegram-test-%'");
    await pool.query("delete from telegram_publication_attempt where owner_id like 'auth0:telegram-test-%'");
    await pool.query("delete from telegram_connection where owner_id like 'auth0:telegram-test-%'");
    await pool.query("delete from telegram_connection_epoch where owner_id like 'auth0:telegram-test-%'");
    await pool.query("delete from app_user where id like 'auth0:telegram-test-%'");
    await pool.query("delete from pilot_account where owner_id like 'auth0:telegram-test-%'");

    const start = await startTelegramLink(ownerA, null, null);
    assertConfiguredStart(start);
    const authUrl = new URL(start.authorizationUrl);
    assert.equal(authUrl.origin, "https://oauth.telegram.org");
    assert.equal(authUrl.searchParams.get("scope"), "openid profile telegram:bot_access");
    assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authUrl.searchParams.get("code_challenge"));
    const session = start.session;
    const missingExpiry = await startTelegramLink(ownerA, null, null);
    assertConfiguredStart(missingExpiry);
    const invalidClaims = credentials(missingExpiry.authorizationUrl, "code-no-exp", { sub: "missing-exp-sub", id: 111222333, missingExp: true });
    const invalidCallback = await callbackTelegramLink(new Request(invalidClaims.callbackUrl), ownerA, missingExpiry.session);
    assert.equal(new URL(invalidCallback.headers.get("location")!).searchParams.get("telegram_error"), "telegram_identity_invalid");
    assert.equal((await pool.query("select status from telegram_link_transaction where state_hash=$1", [sha(invalidClaims.state)])).rows[0].status, "FAILED");
    const good = credentials(start.authorizationUrl, "code-good", { sub: "oidc-sub-is-not-the-numeric-id", id: 987654321 });
    const callback = await callbackTelegramLink(new Request(good.callbackUrl), ownerA, session);
    assert.equal(callback.status, 303);
    const location = new URL(callback.headers.get("location")!);
    const handle = location.searchParams.get("telegram_confirmation")!;
    assert.equal(location.pathname, "/account");
    assert.equal(location.searchParams.has("code"), false);
    assert.equal(location.searchParams.has("state"), false);
    const pending = await getTelegramLinkStatus(ownerA, session, handle);
    assert.equal(pending.state, "awaiting_confirmation");
    assert.equal(pending.pending?.displayName, "Linked account");
    await assert.rejects(getTelegramLinkStatus(ownerB, session, handle), (error) => error instanceof TelegramLinkError && error.code === "confirmation_expired");
    await assert.rejects(confirmTelegramLink(ownerA, "wrong-browser-session", handle), (error) => error instanceof TelegramLinkError && error.code === "session_mismatch");
    const connected = await confirmTelegramLink(ownerA, session, handle);
    assert.equal(connected.state, "connected");
    assert.equal("userId" in connected, false);
    const row = (await pool.query<{ telegram_user_id: string; subject: string; connection_revision: number }>("select telegram_user_id,subject,connection_revision from telegram_connection where owner_id=$1", [ownerA])).rows[0];
    assert.equal(row.telegram_user_id, "987654321");
    assert.equal(row.subject, "oidc-sub-is-not-the-numeric-id");
    assert.equal(row.connection_revision, 1);
    await assert.rejects(confirmTelegramLink(ownerA, session, handle), (error) => error instanceof TelegramLinkError && error.code === "transaction_replayed");
    const replay = await callbackTelegramLink(new Request(good.callbackUrl), ownerA, session);
    assert.equal(new URL(replay.headers.get("location")!).searchParams.get("telegram_error"), "transaction_replayed");

    // A unique Telegram identity cannot be confirmed by a second Bunch owner.
    const conflict = await authorized(ownerB, { sub: "a-different-oidc-subject", id: 987654321 });
    await assert.rejects(confirmTelegramLink(ownerB, conflict.session, conflict.confirmationId), (error) => error instanceof TelegramLinkError && error.code === "telegram_account_conflict");

    // An MCP intent is expiring and owner-bound; the wrong Bunch account cannot consume it.
    const intent = await createTelegramLinkIntent(ownerC);
    await assert.rejects(startTelegramLink(ownerB, null, intent), (error) => error instanceof TelegramLinkError && error.code === "session_mismatch");
    const consumedIntent = await pool.query("select consumed_at from telegram_link_intent where token_hash=$1", [sha(intent)]);
    assert.equal(consumedIntent.rows[0].consumed_at, null);

    // Concurrent confirmation and disconnect serialize to a disconnected final state.
    const racing = await authorized(ownerC, { sub: "owner-c-sub", id: 987654322 });
    const outcomes = await Promise.allSettled([confirmTelegramLink(ownerC, racing.session, racing.confirmationId), disconnectTelegramLink(ownerC)]);
    assert.ok(outcomes.some((outcome) => outcome.status === "fulfilled"));
    assert.equal((await getTelegramLinkStatus(ownerC, racing.session)).state, "disconnected");
    const revisionAfterUnlink = Number((await pool.query("select revision from telegram_connection_epoch where owner_id=$1", [ownerC])).rows[0]?.revision ?? 0);
    const relinked = await authorized(ownerC, { sub: "owner-c-sub", id: 987654322 });
    const relinkResult = await confirmTelegramLink(ownerC, relinked.session, relinked.confirmationId);
    assert.equal(relinkResult.connection.revision, revisionAfterUnlink + 1);

    // An in-flight token exchange cannot recreate a pending link after disconnect.
    const inFlight = await startTelegramLink(ownerE, null, null);
    assertConfiguredStart(inFlight);
    const gate = deferred(); const waiting = deferred();
    const flight = credentials(inFlight.authorizationUrl, "code-in-flight", { sub: "owner-e-sub", id: 987654323, gate: { promise: gate.promise, resolve: waiting.resolve } });
    const callbackPromise = callbackTelegramLink(new Request(flight.callbackUrl), ownerE, inFlight.session);
    await waiting.promise;
    await disconnectTelegramLink(ownerE);
    gate.resolve();
    const flightResult = await callbackPromise;
    assert.equal(new URL(flightResult.headers.get("location")!).searchParams.has("telegram_confirmation"), false);
    assert.equal((await getTelegramLinkStatus(ownerE, inFlight.session)).state, "disconnected");

    // Recheck applies only to the revision it actually queried.
    allowBotStart = false;
    const firstD = await authorized(ownerD, { sub: "owner-d-sub", id: 987654324 });
    const unstarted = await confirmTelegramLink(ownerD, firstD.session, firstD.confirmationId);
    assert.equal(unstarted.state, "bot_access_required");
    const recheckGate = deferred(); const recheckEntered = deferred();
    let held = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/getChat") && !held) { held = true; recheckEntered.resolve(); await recheckGate.promise; }
      return await providerFetch(input, init);
    }) as typeof fetch;
    const staleRecheck = recheckTelegramLink(ownerD);
    await recheckEntered.promise;
    await disconnectTelegramLink(ownerD);
    const relinkD = await authorized(ownerD, { sub: "owner-d-sub", id: 987654324 });
    const newLink = await confirmTelegramLink(ownerD, relinkD.session, relinkD.confirmationId);
    recheckGate.resolve();
    await assert.rejects(staleRecheck, (error) => error instanceof TelegramLinkError && error.status === 409);
    assert.equal((await getTelegramLinkStatus(ownerD, relinkD.session)).state, "bot_access_required");
    assert.equal(newLink.connection.revision, unstarted.connection.revision + 1);
    globalThis.fetch = providerFetch;

    // Export contains display-safe connection and attempt metadata, never OIDC subject or numeric Telegram ID.
    await pool.query("insert into pilot_account(owner_id,role,display_name) values($1,'FRIEND','Test account')", [ownerA]);
    await pool.query("insert into telegram_publication_attempt(owner_id,connection_revision,bot_id,pack_name,title_hash,content_hash,status) values($1,1,'123456','mouse_by_BunchStickersBot','private-title-hash','private-content-hash','VERIFIED')", [ownerA]);
    const exported = await new PilotService(pool).export(ownerA);
    const exportedJson = JSON.stringify(exported.data);
    assert.match(exportedJson, /Linked account/);
    assert.doesNotMatch(exportedJson, /987654321|oidc-sub-is-not-the-numeric-id|private-title-hash|private-content-hash|123456/);
    assert.equal((exported.data.telegram_connection as { connection_revision: number }[])[0].connection_revision, 1);

    // Account deletion removes linked identity, pending material, connection epochs and attempts.
    const pilot = new PilotService(pool);
    await pilot.beginDeletion(ownerA);
    await pilot.finishDeletion(ownerA, async () => {});
    assert.equal((await pool.query("select 1 from telegram_connection where owner_id=$1", [ownerA])).rowCount, 0);
    assert.equal((await pool.query("select 1 from telegram_link_transaction where owner_id=$1", [ownerA])).rowCount, 0);
    assert.equal((await pool.query("select 1 from telegram_publication_attempt where owner_id=$1", [ownerA])).rowCount, 0);
    assert.equal((await pool.query("select 1 from telegram_connection_epoch where owner_id=$1", [ownerA])).rowCount, 0);

    // Expired verifier rows are deleted by the daily cleanup path.
    const stale = await startTelegramLink(`${ownerA}-stale`, null, null);
    assertConfiguredStart(stale);
    const staleState = new URL(stale.authorizationUrl).searchParams.get("state")!;
    await pool.query("update telegram_link_transaction set expires_at=now()-interval '1 second' where state_hash=$1", [sha(staleState)]);
    const expired = await callbackTelegramLink(new Request(`https://bunch.example.test/api/v1/account/telegram/callback?state=${staleState}&code=expired`), `${ownerA}-stale`, stale.session);
    assert.equal(new URL(expired.headers.get("location")!).searchParams.get("telegram_error"), "transaction_expired");
    assert.equal((await pool.query("select 1 from telegram_link_transaction where state_hash=$1", [sha(staleState)])).rowCount, 0);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorEnv.origin === undefined) delete process.env.SYSTEM_PUBLIC_ORIGIN; else process.env.SYSTEM_PUBLIC_ORIGIN = priorEnv.origin;
    if (priorEnv.bot === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = priorEnv.bot;
    if (priorEnv.clientId === undefined) delete process.env.TELEGRAM_OIDC_CLIENT_ID; else process.env.TELEGRAM_OIDC_CLIENT_ID = priorEnv.clientId;
    if (priorEnv.clientSecret === undefined) delete process.env.TELEGRAM_OIDC_CLIENT_SECRET; else process.env.TELEGRAM_OIDC_CLIENT_SECRET = priorEnv.clientSecret;
    for (const owner of [ownerA, ownerB, ownerC, ownerD, ownerE, `${ownerA}-stale`]) {
      try {
        await pool.query("delete from telegram_link_transaction where owner_id=$1", [owner]);
        await pool.query("delete from telegram_link_intent where owner_id=$1", [owner]);
        await pool.query("delete from telegram_publication_attempt where owner_id=$1", [owner]);
        await pool.query("delete from telegram_connection where owner_id=$1", [owner]);
        await pool.query("delete from telegram_connection_epoch where owner_id=$1", [owner]);
        await pool.query("delete from telegram_link_rate where rate_key=$1", [owner]);
        await pool.query("delete from app_user where id=$1", [owner]);
        await pool.query("delete from pilot_account where owner_id=$1", [owner]);
      } catch { /* Preserve the primary test failure; all rows use isolated synthetic owners. */ }
    }
    await pool.end(); delete globals.systemPool;
  }
});
