"use client";

import { useEffect, useState } from "react";
import type { TelegramLinkStartResponse, TelegramLinkStatus } from "@/domain/telegram-link";

const endpoint = "/api/v1/account/telegram";

export function TelegramLinkControls({ confirmationId, errorCode, intent }: { confirmationId: string | null; errorCode: string | null; intent: string | null }) {
  const [status, setStatus] = useState<TelegramLinkStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function load(confirmation?: string | null, signal?: AbortSignal) {
    const response = await fetch(confirmation ? `${endpoint}?confirmation=${encodeURIComponent(confirmation)}` : endpoint, { cache: "no-store", signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "Telegram connection status is unavailable.");
    setStatus(body as TelegramLinkStatus);
    setUnavailable(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    const initialize = async () => {
      try {
        if (confirmationId) {
          await load(confirmationId, controller.signal);
        } else {
          await load(null, controller.signal);
        }
        if (errorCode) setError(errorCode === "cancelled" ? "Telegram authorization was cancelled." : "Telegram could not be connected. Try again.");
      } catch (cause) {
        if (controller.signal.aborted) return;
        // Expired or account-mismatched callback handles must leave usable retry controls.
        try { await load(null, controller.signal); }
        catch { if (!controller.signal.aborted) setUnavailable(true); }
        setError(cause instanceof Error ? cause.message : "Telegram connection status is unavailable.");
      }
    };
    void initialize();
    return () => controller.abort();
  }, [confirmationId, errorCode]);

  async function action(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await run(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Telegram request failed. Please retry."); }
    finally { setBusy(false); }
  }

  async function connect() {
    await action(async () => {
      const response = await fetch(`${endpoint}/start`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(intent ? { intent } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Telegram authorization could not start.");
      const result = body as TelegramLinkStartResponse;
      if (result.state === "disabled") {
        setStatus({ state: "disabled" });
        setNotice("Telegram account linking is temporarily unavailable.");
        return;
      }
      // Telegram consent is a full-page navigation so keyboard and screen-reader context remains clear.
      location.assign(result.authorizationUrl);
    });
  }

  async function recheck() {
    await action(async () => {
      const response = await fetch(`${endpoint}/recheck`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Bot access could not be checked.");
      setStatus(body as TelegramLinkStatus);
      setNotice(body.botAccess === "granted" ? "Bot access confirmed." : "Bot access is still needed. Start the bot, then check again.");
    });
  }

  async function disconnect() {
    await action(async () => {
      const response = await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Telegram could not be disconnected.");
      setStatus(body as TelegramLinkStatus);
      setNotice("Telegram disconnected from this Bunch account.");
    });
  }

  const handle = status?.connection ?? status?.pending;
  const name = handle?.displayName || (handle?.username ? `@${handle.username}` : "Telegram account");
  return <section className="telegram-link-controls" aria-labelledby="telegram-link-heading">
    <h2 id="telegram-link-heading">Telegram account</h2>
    <p>Connect your Telegram account to prepare sticker packs for review. Connecting does not approve or publish a pack. Bunch never asks you for Telegram tokens or numeric account IDs.</p>
    {notice && <p role="status" className="pilot-notice">{notice}</p>}
    {error && <p role="alert" className="pilot-notice telegram-error">{error}</p>}
    {unavailable ? <div><p>The current Telegram connection status is unavailable. Bunch could not verify whether an account is connected.</p><button className="button" disabled={busy} onClick={() => void action(async () => { await load(); setNotice("Telegram connection status refreshed."); })}>Retry Telegram status</button></div> : !status ? <p role="status">Loading Telegram connection…</p> : status.state === "disabled" ? <p>Telegram account linking is temporarily unavailable.</p> : status.state === "awaiting_confirmation" ? <>
      <p><strong>Review this Telegram account:</strong> {name}{status.pending?.username && status.pending.displayName ? ` (@${status.pending.username})` : ""}</p>
      <p>Confirm only if this is the account you want linked to this Bunch account.</p>
      <button className="button" disabled={busy} onClick={() => void action(async () => {
        const response = await fetch(`${endpoint}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationId: confirmationId ?? status.pending?.confirmationId }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Telegram account could not be confirmed.");
        setStatus(body as TelegramLinkStatus); setNotice("Telegram account connected to this Bunch account.");
      })}>Confirm Telegram account</button>
    </> : status.state === "connected" || status.state === "bot_access_required" ? <>
      <p><strong>Connected Telegram account:</strong> {name}{status.connection?.username && status.connection.displayName ? ` (@${status.connection.username})` : ""}</p>
      <p>Connection is private to this Bunch account. Sticker publication always requires a separate review and approval.</p>
      {status.state === "bot_access_required" && <div className="telegram-bot-access">
        <h3>Allow the Bunch sticker bot to create your packs</h3>
        <p>Telegram account linking is complete. Start the shared Bunch bot in Telegram, then recheck access here. This does not send a message from Bunch or publish a pack.</p>
        {status.botStartUrl && <p><a className="button button-secondary" href={status.botStartUrl} target="_blank" rel="noreferrer">Start the Bunch Telegram bot</a></p>}
        <button className="button" disabled={busy} onClick={() => void recheck()}>Recheck bot access</button>
      </div>}
      <div className="telegram-link-actions">
        <button className="button button-secondary" disabled={busy} onClick={() => void connect()}>Change Telegram account</button>
        <button className="button button-secondary" disabled={busy} onClick={() => void disconnect()}>Disconnect Telegram</button>
      </div>
    </> : <>
      <p>No Telegram account is connected.</p>
      <button className="button" disabled={busy} onClick={() => void connect()}>Connect Telegram</button>
    </>}
  </section>;
}
