"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PresencePeriod } from "@/domain/presence";
import type { SystemHostView } from "@/domain/host";
type Profile = { id: string; name: string };
type Action = "HOST" | "START" | "CLEAR" | "END";
type Attempt = {
  requestId: string;
  url: string;
  body: Record<string, unknown>;
  action: Action;
};
async function read<T>(
  url: string,
  signal: AbortSignal,
): Promise<{ data: T; meta?: { nextCursor?: string } }> {
  const response = await fetch(url, {
    cache: "no-store",
    signal,
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error?.message ?? "Unable to read private records.",
    );
  return payload;
}

async function allProfiles(signal: AbortSignal) {
  const profiles: Profile[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await read<Profile[]>(
      `/api/v1/alters?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal,
    );
    profiles.push(...page.data);
    cursor = page.meta?.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("Unable to finish loading profiles. Try again.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return profiles;
}

export function FrontSwitchPanel({
  onConfirmed,
  onNotice,
}: {
  onConfirmed: (periodId?: string) => void;
  onNotice: (notice: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const saved = useRef<{ action: Action; periodId?: string } | null>(null);
  const [needsRead, setNeedsRead] = useState(false);
  const [uncertain, setUncertain] = useState(false),
    [reload, setReload] = useState(0);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [host, setHost] = useState<SystemHostView | null>(null);
  const [presence, setPresence] = useState<{
    hosting: PresencePeriod | null;
    fronting: PresencePeriod[];
  }>({ hosting: null, fronting: [] });
  const [action, setAction] = useState<Action>("START"),
    [selected, setSelected] = useState(""),
    [message, setMessage] = useState("");
  const attempt = useRef<Attempt | null>(null),
    submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) trigger.current?.focus();
      restoreFocus.current = false;
      return;
    }
    heading.current?.focus();
    const controller = new AbortController();
    void Promise.all([
      allProfiles(controller.signal),
      read<SystemHostView | null>("/api/v1/hosting/current", controller.signal),
      read<typeof presence>("/api/v1/presence/current", controller.signal),
    ])
      .then(([ps, h, p]) => {
        if (!controller.signal.aborted) {
          setProfiles(ps);
          setHost(h.data);
          setPresence(p.data);
          setReady(true);
          setMessage(
            "Choose the experience and explicitly confirm the change.",
          );
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setMessage(e.message || "Unable to load records.");
      });
    return () => controller.abort();
  }, [open, reload]);
  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }
  async function refreshSaved() {
    const confirmed = saved.current;
    if (!confirmed) return;
    setMessage("Change saved. Reading current hosting and fronting…");
    try {
      const signal = AbortSignal.timeout(15_000);
      const [h, p] = await Promise.all([
        read<SystemHostView | null>("/api/v1/hosting/current", signal),
        read<typeof presence>("/api/v1/presence/current", signal),
      ]);
      setHost(h.data);
      setPresence(p.data);
      saved.current = null;
      setNeedsRead(false);
      onConfirmed(confirmed.periodId);
      onNotice(
        confirmed.action === "HOST"
          ? "Hosting recorded. Fronting episodes continue independently."
          : confirmed.action === "CLEAR"
            ? "Hosting ended. Fronting episodes continue independently."
            : confirmed.action === "START"
              ? "Fronting episode recorded. Hosting is unchanged."
              : "Fronting episode ended. Hosting and other episodes are unchanged.",
      );
      close();
    } catch {
      setNeedsRead(true);
      setReady(false);
      setMessage("Your change was saved, but current records could not be read. Retry reading records; this will not save the change again.");
    }
  }
  async function retryRead() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try { await refreshSaved(); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !ready) return;
    const episode = presence.fronting.find((p) => p.id === selected);
    if (
      !attempt.current &&
      ((action !== "CLEAR" && !selected) || (action === "END" && !episode))
    )
      return;
    const pending = attempt.current ?? {
      requestId: crypto.randomUUID(),
      action,
      url:
        action === "HOST" || action === "CLEAR"
          ? "/api/v1/hosting/current"
          : `/api/v1/presence/fronting/${action === "START" ? "start" : "end"}`,
      body:
        action === "HOST" || action === "CLEAR"
          ? {
              alterId: action === "CLEAR" ? null : selected,
              expectedVersion: host?.version ?? null,
            }
          : action === "START"
            ? { alterId: selected }
            : { episodeId: selected, expectedVersion: episode!.version },
    };
    attempt.current = pending;
    submitting.current = true;
    setBusy(true);
    setMessage("Recording your confirmed change…");
    try {
      const response = await fetch(pending.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.requestId,
        },
        body: JSON.stringify(pending.body),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status >= 500) throw new Error("Uncertain response");
        attempt.current = null;
        setUncertain(false);
        setReady(false);
        setSelected("");
        setMessage(
          response.status === 409
            ? "The record changed. Reload, choose again, and confirm."
            : (payload.error?.message ?? "Unable to record change."),
        );
        return;
      }
      attempt.current = null;
      setUncertain(false);
      // A confirmed save is never replayed when its follow-up read fails.
      saved.current = {
        action: pending.action,
        periodId: pending.action === "START" ? payload.data.id : undefined,
      };
      await refreshSaved();
    } catch {
      setUncertain(true);
      setMessage(
        "The change may be saved. Retry the same confirmed change safely before choosing another.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const choices =
    action === "END"
      ? presence.fronting.map((p) => ({ id: p.id, name: p.alterName }))
      : profiles;
  return (
    <div className="command-switch">
      <button
        ref={trigger}
        className="command-action"
        aria-expanded={open}
        onClick={() => {
          setReady(false);
          setSelected("");
          setAction("START");
          setMessage("Loading recorded hosting and fronting…");
          setOpen(true);
        }}
        disabled={open}
      >
        Set host or start side fronter
      </button>
      {open ? (
        <section
          className="command-create"
          aria-labelledby="presence-change-heading"
        >
          <h2 id="presence-change-heading" ref={heading} tabIndex={-1}>
            Set host or start a side fronter
          </h2>
          <p role="status">{message}</p>
          {ready ? (
            <div role="group" aria-label="Current recorded state">
              <p><strong>Current host:</strong> {host?.alterName ?? "Not recorded"}</p>
              <p><strong>Active side fronters:</strong> {presence.fronting.length ? presence.fronting.map(p => p.alterName).join(", ") : "No open episodes recorded"}</p>
            </div>
          ) : null}
          {ready ? (
            <form className="form-stack" onSubmit={confirm}>
              <fieldset className="presence-action-picker" disabled={busy || uncertain}>
                <legend>Choose one explicit change</legend>
                <button type="button" className="command-button" aria-pressed={action === "HOST"} onClick={() => { setAction("HOST"); setSelected(""); }}>
                  Set host
                </button>
                <button type="button" className="command-button" aria-pressed={action === "START"} onClick={() => { setAction("START"); setSelected(""); }}>
                  Start side fronter
                </button>
                <button type="button" className="command-button secondary" aria-pressed={action === "END"} onClick={() => { setAction("END"); setSelected(""); }}>
                  End a side-fronting episode
                </button>
                <button type="button" className="command-button secondary" aria-pressed={action === "CLEAR"} onClick={() => { setAction("CLEAR"); setSelected(""); }}>
                  End hosting
                </button>
              </fieldset>
              <p>
                {action === "HOST" || action === "CLEAR"
                  ? `Hosting: ${host?.alterName ?? "not recorded"}. The host is responsible for everything otherwise unclaimed.`
                  : "A side fronter starts an overlapping fronting episode. It does not replace the host or end any other side fronter."}
              </p>
              {action !== "CLEAR" ? (
                <label>
                  {action === "END" ? "Side-fronting episode to end" : action === "HOST" ? "Host profile" : "Side fronter profile"}
                  <select
                    aria-label={action === "END" ? "Side-fronting episode to end" : action === "HOST" ? "Host profile" : "Side fronter profile"}
                    required
                    value={selected}
                    disabled={busy || uncertain}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">
                      Choose a{" "}
                      {action === "END" ? "recorded side-fronting episode" : "profile"}
                    </option>
                    {choices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                className="command-button"
                disabled={
                  busy ||
                  (action !== "CLEAR" && !selected) ||
                  (action === "CLEAR" && !host?.alterId)
                }
              >
                {uncertain
                  ? "Retry confirmed change"
                  : action === "HOST"
                    ? "Confirm host change"
                    : action === "START"
                      ? "Confirm side-fronter arrival"
                      : action === "END"
                        ? "Confirm side-fronting end"
                        : "Confirm hosting end"}
              </button>
            </form>
          ) : (
            <button
              className="command-button secondary"
              disabled={busy}
              onClick={() => needsRead ? void retryRead() : setReload((v) => v + 1)}
            >
              {needsRead ? "Retry reading saved records" : "Reload hosting and fronting"}
            </button>
          )}
          <button
            className="command-button secondary"
            onClick={close}
            disabled={busy || uncertain || needsRead}
          >
            Cancel
          </button>
        </section>
      ) : null}
    </div>
  );
}
