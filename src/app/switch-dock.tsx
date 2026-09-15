"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FrontingHistoryResponse } from "@/domain/fronting-history";
import type { SystemHostView } from "@/domain/host";
import {
  SWITCH_TRIGGERS, elapsed, initials, isArrival, loggedHeadline, recentSwitches, switchEventLine, tapIntent,
  type CurrentPresence, type SwitchEvent, type SwitchIntent, type SwitchMode,
} from "@/domain/switch-dock";

// Other mounted components refresh their own presence reads from this, because
// every page mounts its own navigation and there is no shared layout state.
export const PRESENCE_CHANGED_EVENT = "bunch:presence-changed";
const DOCK_SOURCE = "switch-dock";

type Profile = { id: string; name: string; profilePicture?: { id: string } };
type DockRead = { status: "LOADING" | "SIGNED_OUT" | "ERROR" } | { status: "READY"; presence: CurrentPresence };
type Roster =
  | { status: "IDLE" | "LOADING" | "SIGNED_OUT" | "ERROR" }
  | { status: "READY"; profiles: Profile[]; host: SystemHostView | null; events: SwitchEvent[] | null };
type Attempt = { requestId: string; url: string; body: Record<string, unknown>; intent: SwitchIntent; alterName: string };
type Logged = {
  changeRequestId: string; action: SwitchIntent["action"]; alterName: string; at: string;
  periodId?: string; periodVersion?: number; energy: number | null; trigger: string | null;
};

class ReadError extends Error {
  constructor(readonly status: number) { super(`Read failed with status ${status}.`); }
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new ReadError(response.status);
  return response.json();
}

async function readProfiles() {
  const profiles: Profile[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await readJson<{ data: Profile[]; meta?: { nextCursor?: string } }>(`/api/v1/alters?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    profiles.push(...page.data);
    cursor = page.meta?.nextCursor;
    if (cursor && seen.has(cursor)) throw new ReadError(0);
    if (cursor) seen.add(cursor);
  } while (cursor);
  return profiles;
}

const signedOut = (error: unknown) => error instanceof ReadError && error.status === 401;

async function fetchPresence(): Promise<DockRead> {
  try {
    const payload = await readJson<{ data: Partial<CurrentPresence> }>("/api/v1/presence/current");
    return { status: "READY", presence: { hosting: payload.data.hosting ?? null, fronting: payload.data.fronting ?? [] } };
  } catch (error) {
    return { status: signedOut(error) ? "SIGNED_OUT" : "ERROR" };
  }
}
const clock = (at: string) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
const writeHeaders = (requestId: string) => ({ "Content-Type": "application/json", "Idempotency-Key": requestId });
const announce = (periodId?: string) => window.dispatchEvent(new CustomEvent(PRESENCE_CHANGED_EVENT, { detail: { periodId, source: DOCK_SOURCE } }));

// The accessible name carries the whole recorded state; the visible lines are
// abbreviated so a long name never grows the dock.
function switchLabel(read: DockRead) {
  if (read.status !== "READY") {
    return { LOADING: "Switch. Reading hosting and fronting.", SIGNED_OUT: "Switch. Sign in to read hosting and fronting.", ERROR: "Switch. Hosting and fronting could not be read." }[read.status];
  }
  const hosting = read.presence.hosting ? `Hosting: ${read.presence.hosting.alterName}.` : "No hosting period is recorded.";
  const fronting = read.presence.fronting.length
    ? `Fronting alongside: ${read.presence.fronting.map(p => p.alterName).join(", ")}.`
    : "No open fronting episodes are recorded.";
  return `Switch. ${hosting} ${fronting}`;
}

// "Host" and "Also" are what separate the two roles. Never colour or order alone.
function dockLines(read: DockRead, now: number) {
  if (read.status !== "READY") {
    return { host: { LOADING: "Reading hosting and fronting…", SIGNED_OUT: "Sign in to read hosting and fronting", ERROR: "Hosting and fronting not read" }[read.status], also: "" };
  }
  const { hosting, fronting } = read.presence;
  return {
    host: hosting ? `Host ${hosting.alterName} · ${elapsed(hosting.startedAt, now)}` : "No hosting period recorded",
    also: fronting.length ? `Also ${fronting.map(p => p.alterName).join(", ")}` : "No open fronting episodes",
  };
}

function FaceTile({ profile, presence, mode, now, disabled, onTap }: {
  profile: Profile; presence: CurrentPresence; mode: SwitchMode; now: number; disabled: boolean; onTap: () => void;
}) {
  const [pictureFailed, setPictureFailed] = useState(false);
  const hosting = presence.hosting?.alterId === profile.id ? presence.hosting : null;
  const episode = presence.fronting.find(p => p.alterId === profile.id);
  const state = [hosting ? `Host · ${elapsed(hosting.startedAt, now)}` : "", episode ? `Also · ${elapsed(episode.startedAt, now)}` : ""]
    .filter(Boolean).join(" · ") || "Not recorded";
  const verb = { HOST: "Record as host: ", CLEAR: "End hosting for ", START: "Record as also here: ", END: "End fronting episode for " }[tapIntent(mode, profile.id, presence).action];
  const picture = profile.profilePicture?.id;
  return <button type="button" className="switch-dock-face" data-host={Boolean(hosting)} data-also={Boolean(episode)}
    aria-label={`${verb}${profile.name}. ${state}.`} disabled={disabled} onClick={onTap}>
    <span className="switch-dock-avatar" aria-hidden="true">
      {picture && !pictureFailed
        ? <Image src={`/api/system/gallery-images/${encodeURIComponent(picture)}`} alt="" width={44} height={44} unoptimized onError={() => setPictureFailed(true)} />
        : initials(profile.name)}
    </span>
    <span className="switch-dock-face-text" aria-hidden="true">
      <span className="switch-dock-face-name">{profile.name}</span>
      <span className="switch-dock-face-state">{state}</span>
    </span>
  </button>;
}

// One tap on a face is the explicit report and writes immediately. Energy and
// trigger are asked after the write and are optional; Undo retracts the write.
export function SwitchDock() {
  const [read, setRead] = useState<DockRead>({ status: "LOADING" });
  const [roster, setRoster] = useState<Roster>({ status: "IDLE" });
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SwitchMode>("HOST");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [logged, setLogged] = useState<Logged | null>(null);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const trigger = useRef<HTMLButtonElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const loggedHeading = useRef<HTMLParagraphElement>(null);
  const attempt = useRef<Attempt | null>(null);
  const followUp = useRef<{ key: string; requestId: string } | null>(null);
  const submitting = useRef(false);
  const rosterRequested = useRef(false);

  // A failed read never raises an alert in the dock; signed-out pages mount it
  // too, and Switch still opens.
  const readPresence = useCallback(async () => {
    const next = await fetchPresence();
    setRead(next);
    return next.status === "READY" ? next.presence : null;
  }, []);

  const readRoster = useCallback(async () => {
    rosterRequested.current = true;
    try {
      const [profiles, host, history] = await Promise.all([
        readProfiles(),
        readJson<{ data: SystemHostView | null }>("/api/v1/hosting/current"),
        readJson<FrontingHistoryResponse>("/api/v1/fronting/history?limit=12").catch(() => null),
      ]);
      setRoster({ status: "READY", profiles, host: host.data, events: history ? recentSwitches(history.data) : null });
    } catch (error) {
      setRoster({ status: signedOut(error) ? "SIGNED_OUT" : "ERROR" });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetchPresence().then(next => { if (active) setRead(next); });
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    const onChanged = (event: Event) => {
      if ((event as CustomEvent<{ source?: string }>).detail?.source === DOCK_SOURCE) return;
      void readPresence();
      if (rosterRequested.current) void readRoster();
    };
    window.addEventListener(PRESENCE_CHANGED_EVENT, onChanged);
    return () => { active = false; window.clearInterval(tick); window.removeEventListener(PRESENCE_CHANGED_EVENT, onChanged); };
  }, [readPresence, readRoster]);

  function openPanel() {
    setNotice("");
    setOpen(true);
    if (roster.status !== "READY") setRoster({ status: "LOADING" });
    // Always reread: the host version must be current before a tap writes.
    void readPresence();
    void readRoster();
  }
  function closePanel(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }
  useEffect(() => { if (open) panelHeading.current?.focus(); }, [open]);
  const loggedId = logged?.changeRequestId;
  useEffect(() => { if (loggedId) loggedHeading.current?.focus(); }, [loggedId]);

  // Switching is handled here rather than by navigating, so S works from every page.
  const keys = useRef({ open, openPanel, closePanel });
  useEffect(() => { keys.current = { open, openPanel, closePanel }; });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = keys.current;
      if (event.key === "Escape") {
        if (current.open) { event.preventDefault(); current.closePanel(); }
        return;
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.toLowerCase() !== "s") return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
      event.preventDefault();
      if (current.open) panelHeading.current?.focus();
      else current.openPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function send(pending: Attempt) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setLogged(null);
    setNotice(`Recording ${pending.alterName}…`);
    try {
      const response = await fetch(pending.url, { method: "POST", headers: writeHeaders(pending.requestId), body: JSON.stringify(pending.body) });
      const payload = await response.json().catch(() => null);
      if (response.status >= 500) throw new Error("Uncertain response");
      attempt.current = null;
      setUncertain(false);
      if (!response.ok) {
        setNotice(response.status === 409
          ? "That record changed before the tap was saved. Current records were read again; tap again if it is still right."
          : payload?.error?.message ?? "That switch could not be recorded.");
        await Promise.all([readPresence(), readRoster()]);
        return;
      }
      const { action } = pending.intent;
      const [presence] = await Promise.all([readPresence(), readRoster()]);
      const period = action === "START" ? payload?.data
        : action === "HOST" && presence?.hosting?.alterId === pending.body.alterId ? presence?.hosting : undefined;
      const at = action === "END" ? payload?.data?.endedAt : action === "START" ? payload?.data?.startedAt : payload?.data?.recordedAt;
      setLogged({
        changeRequestId: pending.requestId, action, alterName: pending.alterName,
        at: typeof at === "string" ? at : new Date().toISOString(),
        periodId: period?.id, periodVersion: period?.version, energy: null, trigger: null,
      });
      setNotice(presence ? "" : "The switch was saved, but current records could not be read. Open Switch to read them again.");
      closePanel(false);
      announce(action === "START" ? payload?.data?.id : undefined);
    } catch {
      setUncertain(true);
      setNotice(`The switch for ${pending.alterName} may be saved. Retry the same switch before choosing another.`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function tap(profile: Profile) {
    if (submitting.current || uncertain || read.status !== "READY" || roster.status !== "READY") return;
    const intent = tapIntent(mode, profile.id, read.presence);
    const target = intent.action === "HOST" || intent.action === "CLEAR"
      ? { url: "/api/v1/hosting/current", body: { alterId: intent.action === "HOST" ? profile.id : null, expectedVersion: roster.host?.version ?? null } }
      : intent.action === "START"
        ? { url: "/api/v1/presence/fronting/start", body: { alterId: profile.id } }
        : { url: "/api/v1/presence/fronting/end", body: { episodeId: intent.episode.id, expectedVersion: intent.episode.version } };
    attempt.current = { requestId: crypto.randomUUID(), intent, alterName: profile.name, ...target };
    void send(attempt.current);
  }

  // Undo and Done reuse one request ID per logged switch, so a lost response
  // retries safely instead of repeating the change.
  function followUpId(key: string) {
    if (followUp.current?.key !== key) followUp.current = { key, requestId: crypto.randomUUID() };
    return followUp.current.requestId;
  }

  async function undo(entry: Logged) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setNotice("Undoing…");
    try {
      const response = await fetch("/api/v1/presence/retract", {
        method: "POST", headers: writeHeaders(followUpId(`undo:${entry.changeRequestId}`)), body: JSON.stringify({ changeRequestId: entry.changeRequestId }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status >= 500) throw new Error("Uncertain response");
      followUp.current = null;
      setLogged(null);
      setNotice(response.ok ? `Undone. The switch for ${entry.alterName} is no longer recorded.` : payload?.error?.message ?? "That switch could not be undone.");
      await Promise.all([readPresence(), readRoster()]);
      if (response.ok) announce();
      trigger.current?.focus();
    } catch {
      setNotice("Undo may have been saved. Press Undo again to finish it safely.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function done(entry: Logged) {
    if (submitting.current) return;
    if (!entry.periodId || !entry.periodVersion || (entry.energy === null && entry.trigger === null)) {
      setLogged(null);
      trigger.current?.focus();
      return;
    }
    const body = { energy: entry.energy, trigger: entry.trigger, expectedVersion: entry.periodVersion };
    submitting.current = true;
    setBusy(true);
    setNotice("Saving energy and trigger…");
    try {
      const response = await fetch(`/api/v1/presence/periods/${entry.periodId}/details`, {
        method: "POST", headers: writeHeaders(followUpId(`details:${entry.changeRequestId}:${JSON.stringify(body)}`)), body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null);
      if (response.status >= 500) throw new Error("Uncertain response");
      followUp.current = null;
      setLogged(null);
      setNotice(response.ok
        ? `Energy and trigger saved with ${entry.alterName}’s record.`
        : response.status === 409 ? "The record changed, so energy and trigger were not saved." : payload?.error?.message ?? "Energy and trigger could not be saved.");
      if (response.ok) void readRoster();
      trigger.current?.focus();
    } catch {
      setNotice("Energy and trigger may be saved. Press Done again to finish safely.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const presence = read.status === "READY" ? read.presence : null;
  const lines = dockLines(read, now);
  const canTap = Boolean(presence) && roster.status === "READY" && !busy && !uncertain;
  const rosterProblem = read.status === "SIGNED_OUT" || roster.status === "SIGNED_OUT" ? "SIGNED_OUT"
    : read.status === "ERROR" || roster.status === "ERROR" ? "ERROR" : null;

  return <section className="switch-dock" aria-label="Switch dock">
    {open ? <div id="switch-dock-panel" className="switch-dock-panel" role="region" aria-labelledby="switch-dock-heading">
      <div className="switch-dock-picker">
        <div className="switch-dock-modes">
          <h2 id="switch-dock-heading" className="switch-dock-kicker" ref={panelHeading} tabIndex={-1}>Record a switch as</h2>
          <button type="button" className="switch-dock-mode host" aria-pressed={mode === "HOST"} disabled={busy || uncertain} onClick={() => setMode("HOST")}>
            <span className="switch-dock-dot" aria-hidden="true" />Host
          </button>
          <button type="button" className="switch-dock-mode" aria-pressed={mode === "ALSO"} disabled={busy || uncertain} onClick={() => setMode("ALSO")}>
            <span className="switch-dock-dot" aria-hidden="true" />Also here
          </button>
          <p className="switch-dock-hint">{mode === "HOST" ? "Replaces the open hosting period" : "Opens an overlapping episode; host unchanged"}</p>
        </div>
        {uncertain ? <button type="button" className="switch-dock-secondary" disabled={busy} onClick={() => { if (attempt.current) void send(attempt.current); }}>Retry switch</button> : null}
        {presence && roster.status === "READY"
          ? roster.profiles.length
            ? <div className="switch-dock-faces">
              {roster.profiles.map(profile => <FaceTile key={profile.id} profile={profile} presence={presence} mode={mode} now={now} disabled={!canTap} onTap={() => tap(profile)} />)}
            </div>
            : <p className="switch-dock-empty">No profiles are saved yet. <Link href="/profiles">Add people</Link> to record switches.</p>
          : rosterProblem === "SIGNED_OUT"
            ? <p className="switch-dock-empty">Sign in to record switches.</p>
            : rosterProblem === "ERROR"
              ? <p className="switch-dock-empty">Profiles or current records could not be read.{" "}
                <button type="button" className="switch-dock-secondary" onClick={() => { setRoster({ status: "LOADING" }); void readPresence(); void readRoster(); }}>Read again</button></p>
              : <p className="switch-dock-empty">Reading profiles…</p>}
      </div>
      <section className="switch-dock-recent" aria-labelledby="switch-dock-recent-heading">
        <h3 id="switch-dock-recent-heading" className="switch-dock-kicker">Recent switches</h3>
        {roster.status === "READY" && roster.events?.length
          ? <ol>{roster.events.map(event => <li key={event.key}>
            <span className="switch-dock-avatar small" aria-hidden="true">{initials(event.alterName)}</span>
            <span className="switch-dock-event-line">{switchEventLine(event)}</span>
            <time dateTime={event.at}>{elapsed(event.at, now)}</time>
            {event.detail ? <span className="switch-dock-event-detail">{event.detail}</span> : null}
          </li>)}</ol>
          : <p>{roster.status !== "READY" ? "Reading recent switches…" : roster.events ? "No switches recorded yet." : "Recent switches could not be read."}</p>}
        <p className="switch-dock-footnote">Saved reports, not a fresh check. Episodes stay open until an end is recorded.</p>
      </section>
    </div> : null}

    {logged ? <div className="switch-dock-logged" role="group" aria-labelledby="switch-dock-logged-heading">
      <p id="switch-dock-logged-heading" ref={loggedHeading} tabIndex={-1}><strong>{loggedHeadline(logged.action, logged.alterName, clock(logged.at))}</strong></p>
      {isArrival(logged.action) && logged.periodId ? <>
        <div className="switch-dock-energy" role="group" aria-label="Energy">
          <span className="switch-dock-kicker" aria-hidden="true">Energy</span>
          {[1, 2, 3, 4, 5].map(level => <button key={level} type="button" className="switch-dock-energy-dot" aria-label={`Energy ${level} of 5`}
            aria-pressed={logged.energy === level} data-filled={logged.energy !== null && logged.energy >= level} disabled={busy}
            onClick={() => setLogged(entry => entry && { ...entry, energy: entry.energy === level ? null : level })}>
            <span aria-hidden="true" />
          </button>)}
        </div>
        <div className="switch-dock-triggers" role="group" aria-label="Trigger">
          <span className="switch-dock-kicker" aria-hidden="true">Trigger</span>
          {SWITCH_TRIGGERS.map(label => <button key={label} type="button" className="switch-dock-chip" aria-pressed={logged.trigger === label} disabled={busy}
            onClick={() => setLogged(entry => entry && { ...entry, trigger: entry.trigger === label ? null : label })}>
            <span className="switch-dock-dot" aria-hidden="true" />{label}
          </button>)}
        </div>
      </> : null}
      <div className="switch-dock-logged-actions">
        <button type="button" className="switch-dock-secondary" disabled={busy} onClick={() => void undo(logged)}>Undo</button>
        <button type="button" className="switch-dock-primary" disabled={busy} onClick={() => void done(logged)}>Done</button>
      </div>
    </div> : null}

    {notice ? <p className="switch-dock-notice" role="status">{notice}</p> : null}

    <div className="switch-dock-bar">
      <span className="switch-dock-avatar host" aria-hidden="true">{presence?.hosting ? initials(presence.hosting.alterName) : "—"}</span>
      <span className="switch-dock-state" aria-hidden="true">
        <span className="switch-dock-host-line">{lines.host}</span>
        {lines.also ? <span className="switch-dock-also-line">{lines.also}</span> : null}
      </span>
      <button type="button" ref={trigger} className="switch-dock-action" aria-controls="switch-dock-panel" aria-expanded={open} aria-keyshortcuts="s"
        aria-label={switchLabel(read)} onClick={() => (open ? closePanel() : openPanel())}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
        Switch <kbd>S</kbd>
      </button>
    </div>
  </section>;
}
