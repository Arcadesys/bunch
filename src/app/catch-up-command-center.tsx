"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CatchUpItem, CatchUpReviewState, CatchUpSession } from "@/domain/catch-up";
import { AppNavigation } from "./app-navigation";
import type { AlterView, NoteView, TodoView } from "@/domain/contracts";
import { CurrentFrontSummary } from "./current-front-summary";
import { FrontSwitchPanel } from "./front-switch-panel";

export type CommandView = "CATCH_UP" | "BOARD" | "NOTES" | "THREADS" | "HISTORY";

type IconName = "eye" | "board" | "note" | "thread" | "history" | "profile" | "arrow";

function Icon({ name }: { name: IconName }) {
  const path = {
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
    board: <><rect x="3" y="4" width="18" height="16" rx="1"/><path d="M8 4v16M8 9h13M8 14h13"/></>,
    note: <><path d="M5 3h11l3 3v15H5Z"/><path d="M15 3v4h4M8 11h8M8 15h8"/></>,
    thread: <><path d="M4 5h16v11H9l-5 4Z"/><path d="M8 9h8M8 13h5"/></>,
    history: <><path d="M4 6v5h5"/><path d="M5 11a8 8 0 1 1 2 7"/><path d="M12 8v5l3 2"/></>,
    profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
  }[name];
  return <svg className="command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

function formatTimestamp(value?: string) {
  if (!value) return "First catch-up";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function deferPayload(choice: string, custom: string) {
  if (choice === "NEXT_SWITCH") return { deferUntilNextSwitch: true };
  const date = new Date();
  if (choice === "TODAY") date.setHours(date.getHours() + 4);
  if (choice === "TOMORROW") { date.setDate(date.getDate() + 1); date.setHours(9, 0, 0, 0); }
  if (choice === "CUSTOM") {
    if (!custom) throw new Error("Choose a custom return time.");
    return { deferUntil: new Date(custom).toISOString() };
  }
  return { deferUntil: date.toISOString() };
}

class CatchUpReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function requestCatchUp(periodId?: string) {
  const response = await fetch(`/api/v1/catch-up/current${periodId ? `?periodId=${encodeURIComponent(periodId)}` : ""}`, { headers: { "x-system-demo": "local" }, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new CatchUpReadError(payload.error?.message ?? "Unable to load catch-up.", response.status);
  return payload.data as CatchUpSession | null;
}

type CatchUpLoadState = "loading" | "ready" | "unauthorized" | "error";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

export function CatchUpCommandCenter({ initialView = "CATCH_UP" }: { initialView?: CommandView }) {
  if (initialView === "BOARD" || initialView === "NOTES" || initialView === "THREADS") return <SavedRecords key={initialView} view={initialView} />;
  return <CatchUpView initialView={initialView} />;
}

function CatchUpView({ initialView }: { initialView: "CATCH_UP" | "HISTORY" }) {
  const [frontRefresh,setFrontRefresh] = useState(0);
  const selectedPeriod = useRef<string | undefined>(undefined);
  const [session, setSession] = useState<CatchUpSession | null>(null);
  const [notice, setNotice] = useState("");
  const [loadState, setLoadState] = useState<CatchUpLoadState>("loading");
  const [isPending, startTransition] = useTransition();
  const reviewInFlight = useRef(false);
  const loadGeneration = useRef(0);

  // The front-switch panel can call this directly with its returned `catchUp`.
  const setCatchUpFromServer = (catchUp: CatchUpSession | null) => {
    loadGeneration.current += 1;
    setSession(catchUp);
    setLoadState("ready");
  };

  const loadCatchUp = (periodId = selectedPeriod.current) => {
    const generation = ++loadGeneration.current;
    setLoadState("loading");
    setNotice("");
    return requestCatchUp(periodId).then((data) => {
      if (generation !== loadGeneration.current) return;
      setCatchUpFromServer(data);
      setNotice(data ? "" : "No catch-up is open.");
    }).catch((error: unknown) => {
      if (generation !== loadGeneration.current) return;
      setSession(null);
      const message = error instanceof Error ? error.message : "Unable to load catch-up.";
      setLoadState(error instanceof CatchUpReadError && error.status === 401 ? "unauthorized" : "error");
      setNotice(message);
    });
  };

  useEffect(() => {
    let active = true;
    const generation = loadGeneration.current;
    void requestCatchUp().then((data) => {
      if (!active || generation !== loadGeneration.current) return;
      setCatchUpFromServer(data);
      setNotice(data ? "" : "No catch-up is open.");
    }).catch((error: unknown) => {
      if (!active || generation !== loadGeneration.current) return;
      setSession(null);
      const message = error instanceof Error ? error.message : "Unable to load catch-up.";
      setLoadState(error instanceof CatchUpReadError && error.status === 401 ? "unauthorized" : "error");
      setNotice(message);
    });
    return () => { active = false; };
  }, []);

  const choosePeriod = (periodId: string) => {
    selectedPeriod.current = periodId;
    void loadCatchUp(periodId);
  };
  const presenceChanged = (periodId?: string) => {
    setFrontRefresh(v => v + 1);
    selectedPeriod.current = periodId;
    if (periodId) void loadCatchUp(periodId);
    else setCatchUpFromServer(null);
  };

  const primaryItems = useMemo(() => {
    if (!session) return [];
    return session.items.filter((item) => item.itemType !== "THREAD");
  }, [session]);
  const threads = initialView === "CATCH_UP" ? session?.items.filter((item) => item.itemType === "THREAD") ?? [] : [];

  function setReviewState(item: CatchUpItem, state: CatchUpReviewState, defer?: { choice: string; custom: string }) {
    if (reviewInFlight.current) return;
    reviewInFlight.current = true;
    const generation = loadGeneration.current;
    startTransition(async () => {
      try {
        const body = { expectedVersion: item.version, state, ...(state === "DEFERRED" && defer ? deferPayload(defer.choice, defer.custom) : {}) };
        const requestId = crypto.randomUUID();
        const response = await fetch(`/api/v1/catch-up/items/${item.entryId}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, "x-system-demo": "local" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (generation !== loadGeneration.current) return;
        if (!response.ok) throw new Error(payload.error?.message ?? "Unable to save review state.");
        setSession(payload.data);
        setNotice(`${item.title}: ${reviewLabels[state].toLowerCase()}. The underlying ${item.itemType.toLowerCase()} is unchanged.`);
      } catch (error) { if (generation === loadGeneration.current) setNotice(error instanceof Error ? error.message : "Unable to save review state."); }
      finally { reviewInFlight.current = false; }
    });
  }

  const title = initialView === "CATCH_UP" ? "Needs your eyes" : "Recorded period timeline";
  const description = "The confirmed switch record for this catch-up window.";

  return <main className="command-shell">
    <AppNavigation current={initialView} />
    <section className="command-main">
      <section className="command-hero" aria-labelledby="welcome-heading">
        <div className="command-avatar" aria-hidden="true">{session && loadState === "ready" ? initials(session.alterName) : "?"}</div>
        <div><p className="command-kicker">{loadState === "ready" && session ? "Catch-up · recorded window" : loadState === "ready" ? "Catch-up · choose a period" : loadState === "loading" ? "Catch-up · loading" : "Catch-up unavailable"}</p><h1 id="welcome-heading">{loadState === "ready" && session ? `Catch-up for ${session.alterName}` : loadState === "ready" ? "No catch-up is open" : loadState === "loading" ? "Loading catch-up" : loadState === "unauthorized" ? "Sign in to view your catch-up" : "Catch-up could not be read"}</h1><CurrentFrontSummary refreshKey={frontRefresh} onChoose={choosePeriod} session={session} /></div>
        {loadState === "ready" && session ? <div className="command-progress" aria-label={`${session.reviewedCount} of ${session.totalCount} reviewed`}><strong>{session.reviewedCount} of {session.totalCount}</strong><span>reviewed</span><div className="command-progress-track"><span style={{ width: `${session.totalCount ? session.reviewedCount / session.totalCount * 100 : 100}%` }} /></div></div> : null}
      </section>
      <p className="command-notice" role="status" aria-live="polite">{isPending ? "Saving review state…" : loadState === "loading" ? "Loading your catch-up…" : notice}</p>
      {loadState === "error" ? <button className="command-button" type="button" onClick={() => { void loadCatchUp(); }}>Retry catch-up</button> : null}
      {loadState === "ready" && session ? (initialView === "HISTORY" ? <SwitchTimeline session={session} /> : <>
        <section className="command-section" aria-labelledby="view-heading"><div className="command-section-heading"><div><h2 id="view-heading">{title}</h2>{initialView !== "CATCH_UP" ? <p>{description}</p> : null}</div><span className="command-count">{primaryItems.length} item{primaryItems.length === 1 ? "" : "s"}</span></div>
          <div className="command-items">{primaryItems.length ? primaryItems.map((item) => <CatchUpRow key={item.entryId} item={item} disabled={isPending} onState={setReviewState} />) : <p className="command-empty">Nothing in this view needs your eyes.</p>}</div>
        </section>
        {threads.length ? <section className="command-section" aria-labelledby="threads-heading"><div className="command-section-heading"><div><h2 id="threads-heading">Important threads</h2><p>Approved summaries from Codex and ChatGPT. No raw transcripts.</p></div><span className="command-count">{threads.length} threads</span></div><div className="command-items">{threads.map((item) => <CatchUpRow key={item.entryId} item={item} disabled={isPending} onState={setReviewState} />)}</div></section> : null}
        {initialView === "CATCH_UP" ? <SwitchTimeline session={session} compact /> : null}
      </>) : null}
    </section>
    <aside className="command-actions" aria-labelledby="actions-heading"><h2 id="actions-heading">Quick actions</h2><Link href="/notes" className="command-action"><Icon name="note" /><span><strong>Leave a note</strong><small>For an alter or System-wide</small></span><Icon name="arrow" /></Link><Link href="/board" className="command-action"><Icon name="board" /><span><strong>Add a todo</strong><small>Assign it and set urgency</small></span><Icon name="arrow" /></Link><Link href="/threads" className="command-action"><Icon name="thread" /><span><strong>Save current thread</strong><small>Review before confirmation</small></span><Icon name="arrow" /></Link><FrontSwitchPanel onConfirmed={presenceChanged} onNotice={setNotice} /></aside>
  </main>;
}

const reviewLabels = { NEW: "Not reviewed", ACKNOWLEDGED: "Reviewed", DEFERRED: "Review postponed", RESOLVED: "Review finished" };

function CreateRecordPanel({ view, onNotice, profiles, onSaved }: { view: RecordView; onNotice: (message: string) => void; profiles: AlterView[]; onSaved: () => void }) {
  const [suggestion, setSuggestion] = useState<{ id: string; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitInFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const requestId = crypto.randomUUID();
    const endpoint = view === "BOARD" ? "/api/v1/todos" : view === "NOTES" ? "/api/v1/notes" : "/api/v1/important-threads";
    const body = view === "BOARD" ? { title: form.get("title"), details: form.get("details") || undefined, status: "INBOX", priority: form.get("priority") || undefined, dueOn: form.get("dueOn") || undefined, assigneeAlterIds: form.getAll("recipients") }
      : view === "NOTES" ? { body: form.get("body"), alterId: form.get("recipient") || undefined }
      : { source: form.get("source"), externalThreadId: form.get("url"), url: form.get("url"), title: form.get("title"), approvedSummary: form.get("summary"), keyDecisionOrAction: form.get("nextAction"), recipientAlterIds: form.getAll("recipients") };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, "x-system-demo": "local" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Unable to save the record.");
      onSaved();
      if (view === "THREADS") {
        setSuggestion({ id: payload.data.id, version: payload.data.version });
        onNotice("Thread suggestion saved. Confirm it only after the summary and key action are correct.");
      } else {
        formElement.reset();
        onNotice(view === "BOARD" ? "Todo saved to Board." : "Note saved to Notes.");
      }
    } catch (error) { onNotice(error instanceof Error ? error.message : "Unable to save the record."); }
    finally { submitInFlight.current = false; setBusy(false); }
  }

  async function confirmSuggestion() {
    if (!suggestion || submitInFlight.current) return;
    submitInFlight.current = true;
    setBusy(true);
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/important-threads/${suggestion.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, "x-system-demo": "local" }, body: JSON.stringify({ expectedVersion: suggestion.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Unable to confirm the thread.");
      setSuggestion(null);
      onSaved();
      onNotice("Important thread confirmed. Only the approved link and summary fields were stored.");
    } catch (error) { onNotice(error instanceof Error ? error.message : "Unable to confirm the thread."); }
    finally { submitInFlight.current = false; setBusy(false); }
  }

  if (view === "BOARD") return <section id="create-record" className="command-create" aria-labelledby="create-heading"><h2 id="create-heading">Add a todo</h2><form onSubmit={submit}><label>Title<input disabled={busy} name="title" required maxLength={500} /></label><label>Details <span className="optional">optional</span><textarea disabled={busy} name="details" rows={2} maxLength={5000} /></label><label>Priority<select disabled={busy} name="priority" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option></select></label><label>Due date <span className="optional">optional</span><input disabled={busy} name="dueOn" type="date" /></label><Recipients profiles={profiles} disabled={busy} label="Assign to" /><button className="command-button" disabled={busy}>Save todo</button></form></section>;
  if (view === "NOTES") return <section id="create-record" className="command-create" aria-labelledby="create-heading"><h2 id="create-heading">Leave a note</h2><form onSubmit={submit}><label>Note<textarea disabled={busy} name="body" required rows={4} maxLength={5000} /></label><label>Recipient<select name="recipient" disabled={busy}><option value="">System-wide</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button className="command-button" disabled={busy}>Save note</button></form></section>;
  const invalidateSuggestion = () => setSuggestion(null);
  return <section id="create-record" className="command-create" aria-labelledby="create-heading"><h2 id="create-heading">Save current thread</h2><p>Review the saved summary and action before confirming it for catch-up. No transcript is stored.</p><form onSubmit={submit}><label>Source<select disabled={busy} name="source" onChange={invalidateSuggestion}><option value="CODEX">Codex</option><option value="CHATGPT">ChatGPT</option></select></label><label>Thread link<input disabled={busy} name="url" type="url" required onChange={invalidateSuggestion} /></label><label>Title<input disabled={busy} name="title" required maxLength={500} onChange={invalidateSuggestion} /></label><label>Approved summary<textarea disabled={busy} name="summary" required rows={3} maxLength={5000} onChange={invalidateSuggestion} /></label><label>Key decision or action<textarea disabled={busy} name="nextAction" required rows={2} maxLength={5000} onChange={invalidateSuggestion} /></label><Recipients profiles={profiles} disabled={busy} label="Recipients" onChange={invalidateSuggestion} /><button className="command-button" disabled={busy}>Save suggestion</button>{suggestion ? <button className="command-button secondary" type="button" disabled={busy} onClick={confirmSuggestion}>Confirm important thread</button> : null}</form></section>;
}

function CatchUpRow({ item, disabled, onState }: { item: CatchUpItem; disabled: boolean; onState: (item: CatchUpItem, state: CatchUpReviewState, defer?: { choice: string; custom: string }) => void }) {
  const [showDefer, setShowDefer] = useState(false);
  const [choice, setChoice] = useState("TOMORROW");
  const [custom, setCustom] = useState("");
  const reviewed = item.reviewState !== "NEW";
  return <article className={`command-row ${reviewed ? "is-reviewed" : ""}`}>
    <div className={`command-type type-${item.itemType.toLowerCase()}`}><Icon name={item.itemType === "TODO" ? "board" : item.itemType === "NOTE" ? "note" : item.itemType === "THREAD" ? "thread" : "history"} /><span>{item.itemType === "THREAD" && item.threadSource ? item.threadSource : item.itemType}</span></div>
    <div className="command-row-content"><h3>{item.title}</h3><p className="command-row-meta">From {item.fromLabel} · To {item.toLabel} · {formatTimestamp(item.timestamp)}</p>{item.statusLabel || item.dueOn ? <p className="command-row-status">{item.statusLabel}{item.dueOn ? ` · Due ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${item.dueOn}T12:00:00`))}` : ""}</p> : null}<p className="command-why">{item.whyItMatters}</p><p className="command-next"><strong>Next:</strong> {item.nextAction}</p>{item.threadUrl ? <a className="command-thread-link" href={item.threadUrl} target="_blank" rel="noreferrer">Open approved thread link <Icon name="arrow" /></a> : null}<p className="command-state">{reviewLabels[item.reviewState]}{item.deferUntilNextSwitch ? " · Returns at next recorded period" : item.deferUntil ? ` · Returns ${formatTimestamp(item.deferUntil)}` : ""}</p>
      {showDefer ? <div className="command-defer"><label>Return time<select value={choice} onChange={(event) => setChoice(event.target.value)}><option value="TODAY">Later today</option><option value="TOMORROW">Tomorrow</option><option value="NEXT_SWITCH">Next recorded period</option><option value="CUSTOM">Custom</option></select></label>{choice === "CUSTOM" ? <label>Custom time<input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} /></label> : null}<button className="command-button" disabled={disabled} onClick={() => onState(item, "DEFERRED", { choice, custom })}>Confirm defer</button></div> : null}
      <p>Reviewing this item does not complete or change the original record.</p><div className="command-row-actions"><button className="command-button" disabled={disabled} onClick={() => onState(item, "ACKNOWLEDGED")}>Mark reviewed</button><button className="command-button secondary" disabled={disabled} onClick={() => setShowDefer((value) => !value)}>Review later</button></div>
    </div>
  </article>;
}

function SwitchTimeline({ session, compact = false }: { session: CatchUpSession | null; compact?: boolean }) {
  return <section id="switch-timeline" className={`command-section command-timeline ${compact ? "is-compact" : ""}`} aria-labelledby="timeline-heading"><div className="command-section-heading"><div><h2 id="timeline-heading">Recorded period timeline</h2><p>Recorded period boundaries only. Catch-up does not establish absence.</p></div></div>{session ? <ol><li><span className="timeline-dot" /><div><strong>{session.alterName} · {session.sourceKind === "HOSTING" ? "hosting" : session.sourceKind === "FRONTING" ? "fronting episode" : "legacy record"}</strong><span>{formatTimestamp(session.windowEnd)} · Catch-up opened</span></div></li>{session.windowStart ? <li><span className="timeline-dot" /><div><strong>Previous recorded period of this kind ended for {session.alterName}</strong><span>{formatTimestamp(session.windowStart)} · Catch-up window begins</span></div></li> : null}</ol> : <p className="command-empty">Choose a recorded period for catch-up.</p>}</section>;
}

type RecordView = "BOARD" | "NOTES" | "THREADS";
type SavedThread = { id: string; title: string; url: string; approvedSummary: string; keyDecisionOrAction: string; recipients: string[]; status: string; version: number; updatedAt: string };
type SavedRecord = TodoView | NoteView | SavedThread;
const recordEndpoints = { BOARD: "/api/v1/todos", NOTES: "/api/v1/notes", THREADS: "/api/v1/important-threads" };
const recordTitles = { BOARD: "Board", NOTES: "Notes", THREADS: "Important threads" };

async function readPage<T>(endpoint: string) {
  const response = await fetch(endpoint, { headers: { "x-system-demo": "local" }, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new CatchUpReadError(payload.error?.message ?? "Unable to read records.", response.status);
  return payload as { data: T[]; meta: { nextCursor?: string } };
}

function Recipients({ profiles, disabled, label, onChange }: { profiles: AlterView[]; disabled: boolean; label: string; onChange?: () => void }) {
  return <fieldset disabled={disabled}><legend>{label}</legend><p>Leave everyone unchecked for System-wide.</p>{profiles.map((profile) => <label key={profile.id}><input name="recipients" type="checkbox" value={profile.id} onChange={onChange} /> {profile.name}</label>)}</fieldset>;
}

function SavedRecords({ view }: { view: RecordView }) {
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [profiles, setProfiles] = useState<AlterView[]>([]);
  const [profilesReady, setProfilesReady] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [state, setState] = useState<CatchUpLoadState>("loading");
  const [notice, setNotice] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const generation = useRef(0);

  function refreshRecords() {
    generation.current += 1;
    setRefreshing(true);
    setRefresh((value) => value + 1);
  }

  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    readPage<SavedRecord>(recordEndpoints[view]).then((page) => {
      if (!active || current !== generation.current) return;
      setRecords(page.data); setCursor(page.meta.nextCursor); setState("ready"); setRefreshing(false);
    }).catch((error: unknown) => {
      if (!active || current !== generation.current) return;
      setState(error instanceof CatchUpReadError && error.status === 401 ? "unauthorized" : "error");
      setNotice(error instanceof Error ? error.message : "Unable to read records.");
      setRefreshing(false);
    });
    return () => { active = false; };
  }, [view, refresh]);

  useEffect(() => {
    let active = true;
    async function loadProfiles() {
      const collected: AlterView[] = [];
      let next: string | undefined;
      do {
        const page = await readPage<AlterView>(`/api/v1/alters?limit=100${next ? `&cursor=${encodeURIComponent(next)}` : ""}`);
        collected.push(...page.data); next = page.meta.nextCursor;
      } while (next);
      if (active) { setProfiles(collected); setProfilesReady(true); setProfileError(""); }
    }
    void loadProfiles().catch(() => { if (active) setProfileError("Profiles could not be loaded. Retry to choose recipients and create a record."); });
    return () => { active = false; };
  }, [refresh]);

  async function loadMore() {
    if (!cursor || mutation.current || refreshing) return;
    mutation.current = true; setBusy(true);
    const current = generation.current;
    try {
      const page = await readPage<SavedRecord>(`${recordEndpoints[view]}?cursor=${encodeURIComponent(cursor)}`);
      if (current !== generation.current) return;
      setRecords((existing) => [...existing, ...page.data.filter((item) => !existing.some((record) => record.id === item.id))]);
      setCursor(page.meta.nextCursor);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to read more records."); }
    finally { mutation.current = false; setBusy(false); }
  }

  async function changeRecord(record: TodoView | SavedThread) {
    if (mutation.current || refreshing) return;
    mutation.current = true; setBusy(true);
    const isTodo = "assigneeAlterIds" in record;
    try {
      const response = await fetch(isTodo ? `/api/v1/todos/${record.id}` : `/api/v1/important-threads/${record.id}/confirm`, {
        method: isTodo ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "x-system-demo": "local" },
        body: JSON.stringify({ expectedVersion: record.version, ...(isTodo ? { status: record.status === "DONE" ? "OPEN" : "DONE" } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Unable to update record.");
      setRecords((existing) => existing.map((item) => item.id === record.id ? { ...item, ...payload.data } : item));
      setNotice(isTodo ? record.status === "DONE" ? "Todo reopened." : "Todo marked complete." : "Thread confirmed for catch-up.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to update record."); }
    finally { mutation.current = false; setBusy(false); }
  }

  return <main className="command-shell saved-records"><AppNavigation current={view} /><section className="command-main">
    <section className="command-hero"><div><h1>{recordTitles[view]}</h1><p>Saved {view === "BOARD" ? "todos" : view === "NOTES" ? "notes" : "links and summaries"}, independent of catch-up and current front.</p><a className="command-button" href="#create-record">{view === "BOARD" ? "Add a todo" : view === "NOTES" ? "Leave a note" : "Save a thread"}</a></div></section>
    <p className="command-notice" role="status" aria-live="polite">{state === "loading" ? "Loading saved records…" : notice}</p>
    {state === "unauthorized" ? <p><a href="/auth/login">Sign in to view your saved records</a></p> : state === "error" ? <button className="command-button" onClick={refreshRecords}>Retry records</button> : null}
    {state === "ready" ? <>
      <section className="command-section" aria-label={`Saved ${recordTitles[view]}`}>
        <h2>Saved {view === "BOARD" ? "todos" : view === "NOTES" ? "notes" : "threads"}</h2><button className="command-button secondary" disabled={busy || refreshing} onClick={refreshRecords}>{refreshing ? "Refreshing records…" : "Refresh records"}</button>
        {!records.length ? <p className="command-empty">No saved {view === "BOARD" ? "todos" : view === "NOTES" ? "notes" : "threads"} yet.</p> : null}
        <div className="command-items">{records.map((record) => <article className="command-row" key={record.id}><div className="command-row-content">
          {"body" in record ? <><h3>Note for {record.alterName ?? (record.alterId ? "a linked profile" : "System-wide")}</h3><p style={{ whiteSpace: "pre-wrap" }}>{record.body}</p>{record.actorAlterName ? <p>From {record.actorAlterName}</p> : null}</> : "assigneeAlterIds" in record ? <><h3>{record.title}</h3><p>{record.status.toLowerCase().replaceAll("_", " ")} · {record.priority?.toLowerCase() ?? "normal"} priority</p>{record.details ? <p style={{ whiteSpace: "pre-wrap" }}>{record.details}</p> : null}<p>Assigned to: {record.assigneeAlterIds.length ? record.assigneeAlterIds.map((id) => profiles.find((profile) => profile.id === id)?.name ?? "Linked profile").join(", ") : "System-wide"}</p>{record.dueOn ? <p>Due {record.dueOn}</p> : null}<button className="command-button" disabled={busy || refreshing} onClick={() => changeRecord(record)}>{record.status === "DONE" ? "Reopen todo" : "Mark todo complete"}</button></> : <><h3>{record.title}</h3><p>{record.status === "CONFIRMED" ? "Confirmed for catch-up" : "Suggestion — not yet confirmed"}</p><p>{record.approvedSummary}</p><p><strong>Decision or action:</strong> {record.keyDecisionOrAction}</p><p>For {record.recipients?.length ? record.recipients.join(", ") : "System-wide"}</p><a href={record.url} target="_blank" rel="noreferrer">Open thread</a>{record.status === "SUGGESTED" ? <p><button className="command-button" disabled={busy || refreshing} onClick={() => changeRecord(record)}>Confirm this summary and action</button></p> : null}</>}
          <p className="command-row-meta">Updated {formatTimestamp(record.updatedAt)}</p>
        </div></article>)}</div>
        {cursor ? <button className="command-button" disabled={busy || refreshing} onClick={loadMore}>Load more</button> : null}
      </section>
      {profilesReady ? <CreateRecordPanel view={view} profiles={profiles} onNotice={setNotice} onSaved={refreshRecords} /> : profileError ? <p>{profileError} <button className="command-button" onClick={refreshRecords}>Retry profiles</button></p> : <p>Loading recipient choices…</p>}
    </> : null}
  </section></main>;
}
