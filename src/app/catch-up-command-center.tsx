"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { CatchUpItem, CatchUpReviewState, CatchUpSession } from "@/domain/catch-up";
import { AppNavigation, PRESENCE_CHANGED_EVENT } from "./app-navigation";
import { ListDetail, useListSelection, type ListRow } from "./list-detail";
import type { AlterView, NoteView, TodoView } from "@/domain/contracts";
import { CurrentFrontSummary } from "./current-front-summary";
import { SavedReturnReview } from "./saved-return-review";
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

export function CatchUpCommandCenter({ initialView = "CATCH_UP", focused = false, quiet = false }: { initialView?: CommandView; focused?: boolean; quiet?: boolean }) {
  if (initialView === "BOARD" || initialView === "NOTES" || initialView === "THREADS") return <SavedRecords key={initialView} view={initialView} />;
  return <CatchUpView initialView={initialView} focused={focused} quiet={quiet} />;
}

function CatchUpView({ initialView, focused, quiet }: { initialView: "CATCH_UP" | "HISTORY"; focused: boolean; quiet: boolean }) {
  const [overwhelmed, setOverwhelmed] = useState(quiet);
  const [frontRefresh, setFrontRefresh] = useState(0);
  const selectedPeriod = useRef<string | undefined>(undefined);
  const [session, setSession] = useState<CatchUpSession | null>(null);
  const [notice, setNotice] = useState("");
  const [loadState, setLoadState] = useState<CatchUpLoadState>("loading");
  const [isPending, startTransition] = useTransition();
  const reviewInFlight = useRef(false);
  const reviewReceipt = useRef<{ key: string; requestId: string; body: object } | null>(null);
  const loadGeneration = useRef(0);

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
      if (error instanceof CatchUpReadError && error.status === 401) setSession(null);
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
      if (error instanceof CatchUpReadError && error.status === 401) setSession(null);
      const message = error instanceof Error ? error.message : "Unable to load catch-up.";
      setLoadState(error instanceof CatchUpReadError && error.status === 401 ? "unauthorized" : "error");
      setNotice(message);
    });
    return () => { active = false; };
  }, []);

  const choosePeriod = (periodId: string) => {
    setSession(null);
    selectedPeriod.current = periodId;
    void loadCatchUp(periodId);
  };
  const presenceChanged = (periodId?: string) => {
    setFrontRefresh(v => v + 1);
    setSession(null);
    selectedPeriod.current = periodId;
    void loadCatchUp(periodId);
  };
  const latestPresenceChanged = useRef(presenceChanged);
  useEffect(() => { latestPresenceChanged.current = presenceChanged; });
  useEffect(() => {
    const onPresenceChanged = (event: Event) => latestPresenceChanged.current((event as CustomEvent<{ periodId?: string }>).detail?.periodId);
    window.addEventListener(PRESENCE_CHANGED_EVENT, onPresenceChanged);
    return () => window.removeEventListener(PRESENCE_CHANGED_EVENT, onPresenceChanged);
  }, []);

  const primaryItems = useMemo(() => {
    const urgency = (item: CatchUpItem) => Number(/BLOCKED/.test(item.statusLabel ?? "")) * 4 + Number(/HIGH/.test(item.statusLabel ?? "")) * 2 + Number(Boolean(item.dueOn && new Date(`${item.dueOn}T23:59:59`).getTime() < new Date(session?.windowEnd ?? 0).getTime()));
    return session?.items.filter(item => item.reviewState === "NEW" && (item.itemType === "TODO" && !/^(DONE|CANCELLED)/.test(item.statusLabel ?? "") || item.itemType === "THREAD")).sort((a, b) => urgency(b) - urgency(a) || b.timestamp.localeCompare(a.timestamp)) ?? [];
  }, [session]);

  const updates = useMemo(() => session?.items.filter(item => !primaryItems.includes(item)) ?? [], [session, primaryItems]);
  const allItems = useMemo(() => [...primaryItems, ...updates], [primaryItems, updates]);

  const ids = useMemo(() => allItems.map(item => item.entryId), [allItems]);
  const [selectedId, select] = useListSelection(ids, { autoSelectFirst: initialView === "HISTORY" });
  const current = allItems.find(item => item.entryId === selectedId);

  function setReviewState(item: CatchUpItem, state: CatchUpReviewState, defer?: { choice: string; custom: string }) {
    if (reviewInFlight.current) return;
    reviewInFlight.current = true;
    const generation = loadGeneration.current;
    startTransition(async () => {
      try {
        const key = JSON.stringify({ entryId: item.entryId, version: item.version, state, defer });
        if (reviewReceipt.current?.key !== key) reviewReceipt.current = { key, requestId: crypto.randomUUID(), body: { expectedVersion: item.version, state, ...(state === "DEFERRED" && defer ? deferPayload(defer.choice, defer.custom) : {}) } };
        const { body, requestId } = reviewReceipt.current;
        const response = await fetch(`/api/v1/catch-up/items/${item.entryId}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, "x-system-demo": "local" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (generation !== loadGeneration.current) return;
        if (!response.ok) throw new Error(payload.error?.message ?? "Unable to save review state.");
        reviewReceipt.current = null;
        setSession(payload.data);
        setNotice(`${item.title}: ${reviewLabels[state].toLowerCase()}. The underlying ${item.itemType.toLowerCase()} is unchanged.`);
      } catch (error) { if (generation === loadGeneration.current) setNotice(error instanceof Error ? error.message : "Unable to save review state."); }
      finally { reviewInFlight.current = false; }
    });
  }

  const rows: ListRow[] = useMemo(() => {
    const buildRow = (item: CatchUpItem): ListRow => ({
      id: item.entryId,
      title: item.title,
      meta: item.itemType === "THREAD" && item.threadSource ? item.threadSource : item.itemType,
      time: formatTimestamp(item.timestamp),
      badge: item.reviewState === "NEW" ? { label: "New", tone: "attention" } : undefined,
      muted: item.reviewState !== "NEW",
      group: primaryItems.includes(item) ? "Needs attention" : "What changed",
    });
    return allItems.map(buildRow);
  }, [allItems, primaryItems]);

  return <main className="app-page">
    <AppNavigation current={initialView} />
    <ListDetail
      title="Catch-up"
      count={session ? `${session.reviewedCount} of ${session.totalCount} reviewed` : undefined}
      intro={<p>Read what was saved for this recorded period. Mark reviewed means you&apos;ve read it.</p>}
      rows={rows}
      selectedId={selectedId}
      onSelect={select}
      listTools={
        <div className="ld-tools">
          {session ? (
            <>
              <div className="catch-up-window">
                <p className="command-kicker">Catch-up · recorded window</p>
                <p className="command-window">{session.windowStart ? `Since ${formatTimestamp(session.windowStart)}` : "Previous fronting end unknown · available history"} → {formatTimestamp(session.windowEnd)}</p>
              </div>
              <button className="command-button secondary" disabled={isPending || loadState !== "loading"} onClick={() => void loadCatchUp()}>Refresh catch-up</button>
              <button className="command-button secondary" aria-pressed={overwhelmed} onClick={() => setOverwhelmed(!overwhelmed)}>{overwhelmed ? "Show full catch-up" : "I&apos;m overwhelmed"}</button>
            </>
          ) : null}
        </div>
      }
      listStatus={
        <>
          <p className="command-notice" role="status" aria-live="polite">{isPending ? "Saving review state…" : loadState === "loading" ? "Loading your catch-up…" : notice}</p>
          {loadState === "ready" && !session && <p>No catch-up open. No return window is recorded; you can still read saved notes and tasks without reporting an arrival.</p>}
          {loadState === "error" && <p role="alert">{session ? "Refresh failed. Showing the previously loaded records; they may be out of date." : "Saved records could not be loaded. Retry catch-up, or open Notes or Todos."}</p>}
          {loadState === "unauthorized" && <p><a href="/auth/login">Sign in to view your catch-up</a></p>}
        </>
      }
    >
      {current ? (
        <article className="detail-card" id={`record-${current.itemId}`}>
          <span className="detail-eyebrow">{current.itemType === "THREAD" && current.threadSource ? current.threadSource : current.itemType} · {formatTimestamp(current.timestamp)}</span>
          <h2>{current.title}</h2>
          {(current.statusLabel || current.dueOn) && (
            <div className="detail-facts">
              {current.statusLabel && <div><dt>{current.itemType}</dt><dd>{current.statusLabel}</dd></div>}
              {current.dueOn && <div><dt>Due</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${current.dueOn}T12:00:00`))}</dd></div>}
            </div>
          )}
          {current.whyItMatters && <p>{current.whyItMatters}</p>}
          <div className="detail-callout">
            <span className="detail-eyebrow">Next</span>
            <p>{current.nextAction}</p>
          </div>
          {current.threadUrl && (
            <p><a href={current.threadUrl} target="_blank" rel="noreferrer">Open approved thread link</a></p>
          )}
          <p className="detail-state">{reviewLabels[current.reviewState]}{current.deferUntilNextSwitch ? " · Returns at next recorded period" : current.deferUntil ? ` · Returns ${formatTimestamp(current.deferUntil)}` : ""}</p>
          <div className="detail-actions">
            <CatchUpDetailActions item={current} disabled={isPending || loadState !== "ready"} onState={setReviewState} />
          </div>
          <Link href={`${current.itemType === "NOTE" ? "/notes" : current.itemType === "TODO" ? "/board" : current.itemType === "THREAD" ? "/threads" : "/decisions"}#record-${current.itemId}`}>Open record</Link>
          <p>Reviewing this item does not complete or change the original record.</p>
        </article>
      ) : null}
    </ListDetail>
    {focused && (
      <section className="home-presence focused-presence" aria-labelledby="current-presence-heading">
        <h2 id="current-presence-heading">Current presence record</h2>
        <p>Review the last saved record here. Use Switch above to record an explicit change.</p>
        <CurrentFrontSummary refreshKey={frontRefresh} onChoose={choosePeriod} session={session} />
      </section>
    )}
    {!focused && (
      <section id="presence-controls" tabIndex={-1} className="home-presence" aria-labelledby="hosting-actions-heading">
        <h2 id="hosting-actions-heading">Hosting and fronting controls</h2>
        <p>Choose a current fronter&apos;s catch-up, or explicitly record a change. Hosting and fronting are separate records.</p>
        <FrontSwitchPanel onConfirmed={presenceChanged} onNotice={setNotice} />
        <CurrentFrontSummary refreshKey={frontRefresh} onChoose={choosePeriod} session={session} />
        <a className="task-return" href="#catch-up-records">Back to catch-up</a>
      </section>
    )}
  </main>;
}

const reviewLabels = { NEW: "Not reviewed", ACKNOWLEDGED: "Reviewed", DEFERRED: "Review postponed", RESOLVED: "Review finished" };

function CatchUpDetailActions({ item, disabled, onState }: { item: CatchUpItem; disabled: boolean; onState: (item: CatchUpItem, state: CatchUpReviewState, defer?: { choice: string; custom: string }) => void }) {
  const [showDefer, setShowDefer] = useState(false);
  const [choice, setChoice] = useState("TOMORROW");
  const [custom, setCustom] = useState("");

  return <>
    {showDefer ? (
      <div className="command-defer">
        <label>Return time<select value={choice} onChange={(event) => setChoice(event.target.value)}><option value="TODAY">Later today</option><option value="TOMORROW">Tomorrow</option><option value="NEXT_SWITCH">Next recorded period</option><option value="CUSTOM">Custom</option></select></label>
        {choice === "CUSTOM" ? <label>Custom time<input type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} /></label> : null}
        <button className="command-button" disabled={disabled} onClick={() => onState(item, "DEFERRED", { choice, custom })}>Confirm defer</button>
      </div>
    ) : null}
    <button className="command-button" disabled={disabled} onClick={() => onState(item, "ACKNOWLEDGED")}>Mark reviewed</button>
    <button className="command-button secondary" disabled={disabled} onClick={() => setShowDefer((value) => !value)}>Review later</button>
  </>;
}

function CreateRecordPanel({ view, onNotice, profiles, onSaved, refreshing }: { refreshing: boolean; view: RecordView; onNotice: (message: string) => void; profiles: AlterView[]; onSaved: () => void }) {
  const [formNotice, setFormNotice] = useState("");
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (formNotice && !refreshing) feedbackRef.current?.scrollIntoView({ block: "nearest" }); }, [formNotice, refreshing]);
  const announce = (message: string) => { setFormNotice(message); onNotice(message); };
  const [suggestion, setSuggestion] = useState<{ id: string; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const submitInFlight = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setBusy(true);
    setFormNotice("");
    const formElement = formRef.current ?? event.currentTarget;
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
        announce("Thread suggestion saved. Confirm it only after the summary and key action are correct.");
      } else {
        formRef.current?.reset();
        announce(view === "BOARD" ? "Todo saved to Todos." : "Note saved to Notes.");
      }
    } catch (error) { announce(error instanceof Error ? error.message : "Unable to save the record."); }
    finally { submitInFlight.current = false; setBusy(false); }
  }

  async function confirmSuggestion() {
    if (!suggestion || submitInFlight.current) return;
    submitInFlight.current = true;
    setBusy(true);
    setFormNotice("");
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/important-threads/${suggestion.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId, "x-system-demo": "local" }, body: JSON.stringify({ expectedVersion: suggestion.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Unable to confirm the thread.");
      setSuggestion(null);
      onSaved();
      announce("Important thread confirmed. Only the approved link and summary fields were stored.");
    } catch (error) { announce(error instanceof Error ? error.message : "Unable to confirm the thread."); }
    finally { submitInFlight.current = false; setBusy(false); }
  }

  const feedback = <div className="form-feedback"><p ref={feedbackRef} role="status">{busy ? "Saving…" : formNotice}</p><div className="task-return-links"><a href="#saved-records">View saved {view === "BOARD" ? "todos" : view === "NOTES" ? "notes" : "threads"}</a><Link href="/home">Back to Home</Link></div></div>;
  if (view === "BOARD") return <section id="create-record" className="command-create" aria-labelledby="create-heading"><h2 id="create-heading" tabIndex={-1}>Add a todo</h2><form ref={formRef} onSubmit={submit}><label>Title<input disabled={busy} name="title" required maxLength={500} /></label><label>Details <span className="optional">optional</span><textarea disabled={busy} name="details" rows={2} maxLength={5000} /></label><label>Priority<select disabled={busy} name="priority" defaultValue="NORMAL"><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option></select></label><label>Due date <span className="optional">optional</span><input disabled={busy} name="dueOn" type="date" /></label><Recipients profiles={profiles} disabled={busy} label="Assign to" /><button className="command-button" disabled={busy}>Save todo</button></form>{feedback}</section>;
  if (view === "NOTES") return <section id="create-record" className="command-create" aria-labelledby="create-heading"><h2 id="create-heading" tabIndex={-1}>Leave a note</h2><form ref={formRef} onSubmit={submit}><label>Note<textarea disabled={busy} name="body" required rows={4} maxLength={5000} /></label><label>Recipient<select name="recipient" disabled={busy}><option value="">System-wide</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button className="command-button" disabled={busy}>Save note</button></form>{feedback}</section>;
  const invalidateSuggestion = () => setSuggestion(null);
  return <section id="create-record" className="command-create" aria-labelledby="create-heading"><h2 id="create-heading" tabIndex={-1}>Save a thread</h2><p>Review the saved summary and action before confirming it for catch-up. No transcript is stored.</p><form ref={formRef} onSubmit={submit}><label>Source<select disabled={busy} name="source" onChange={invalidateSuggestion}><option value="CODEX">Codex</option><option value="CHATGPT">ChatGPT</option></select></label><label>Thread link<input disabled={busy} name="url" type="url" required onChange={invalidateSuggestion} /></label><label>Title<input disabled={busy} name="title" required maxLength={500} onChange={invalidateSuggestion} /></label><label>Approved summary<textarea disabled={busy} name="summary" required rows={3} maxLength={5000} onChange={invalidateSuggestion} /></label><label>Key decision or action<textarea disabled={busy} name="nextAction" required rows={2} maxLength={5000} onChange={invalidateSuggestion} /></label><Recipients profiles={profiles} disabled={busy} label="Recipients" onChange={invalidateSuggestion} /><button className="command-button" disabled={busy}>Save suggestion</button>{suggestion ? <button className="command-button secondary" type="button" disabled={busy} onClick={confirmSuggestion}>Confirm important thread</button> : null}</form>{feedback}</section>;
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
      <Link href={`${item.itemType === "NOTE" ? "/notes" : item.itemType === "TODO" ? "/board" : item.itemType === "THREAD" ? "/threads" : "/decisions"}#record-${item.itemId}`}>Open record</Link><p>Reviewing this item does not complete or change the original record.</p><div className="command-row-actions"><button className="command-button" disabled={disabled} onClick={() => onState(item, "ACKNOWLEDGED")}>Mark reviewed</button><button className="command-button secondary" disabled={disabled} onClick={() => setShowDefer((value) => !value)}>Review later</button></div>
    </div>
  </article>;
}

function SwitchTimeline({ session, compact = false }: { session: CatchUpSession | null; compact?: boolean }) {
  return <section id="switch-timeline" className={`command-section command-timeline ${compact ? "is-compact" : ""}`} aria-labelledby="timeline-heading"><div className="command-section-heading"><div><h2 id="timeline-heading">Recorded period timeline</h2><p>Recorded period boundaries only. Catch-up does not establish absence.</p></div></div>{session ? <ol><li><span className="timeline-dot" /><div><strong>{session.alterName} · {session.sourceKind === "HOSTING" ? "hosting" : session.sourceKind === "FRONTING" ? "fronting episode" : "legacy record"}</strong><span>{formatTimestamp(session.windowEnd)} · Catch-up opened</span></div></li>{session.windowStart ? <li><span className="timeline-dot" /><div><strong>Previous recorded period of this kind ended for {session.alterName}</strong><span>{formatTimestamp(session.windowStart)} · Catch-up window begins</span></div></li> : null}</ol> : <p className="command-empty">Choose a recorded period for catch-up.</p>}</section>;
}

type RecordView = "BOARD" | "NOTES" | "THREADS";
type SavedThread = { id: string; title: string; url: string; source: string; approvedSummary: string; keyDecisionOrAction: string; recipients: string[]; status: string; version: number; updatedAt: string };
type SavedRecord = TodoView | NoteView | SavedThread;
const recordEndpoints = { BOARD: "/api/v1/todos", NOTES: "/api/v1/notes", THREADS: "/api/v1/important-threads" };
const recordTitles = { BOARD: "Todos", NOTES: "Notes", THREADS: "Important threads" };

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
  const [creating, setCreating] = useState(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const initialFragmentHandled = useRef(false);

  // Hooks for THREADS view - called unconditionally
  const threadRecords = useMemo(() => records as SavedThread[], [records]);
  const ids = useMemo(() => threadRecords.map(r => r.id), [threadRecords]);
  const [selectedId, select] = useListSelection(ids);
  const threadRowsCurrent = threadRecords.find(r => r.id === selectedId);
  const threadRows: ListRow[] = useMemo(() =>
    threadRecords.map(record => ({
      id: record.id,
      title: record.title,
      meta: record.source,
      time: formatTimestamp(record.updatedAt),
      badge: record.status === "SUGGESTED" ? { label: "Needs confirmation", tone: "attention" } : undefined,
    })),
    [threadRecords]
  );

  function refreshRecords() {
    generation.current += 1;
    setRefreshing(true);
    setRefresh((value) => value + 1);
  }

  useEffect(() => {
    let active = true;
    const current = ++generation.current;
    readPage<SavedRecord>(recordEndpoints[view]).then(async (page) => {
      const target = window.location.hash.startsWith("#record-") ? window.location.hash.slice(8) : undefined;
      const collected = [...page.data];
      let next = page.meta.nextCursor;
      const seen = new Set<string>();
      while (active && current === generation.current && target && !collected.some(record => record.id === target) && next && !seen.has(next)) {
        seen.add(next);
        const more = await readPage<SavedRecord>(`${recordEndpoints[view]}?cursor=${encodeURIComponent(next)}`);
        collected.push(...more.data); next = more.meta.nextCursor;
      }
      page = { data: collected, meta: { nextCursor: next } };
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

  useEffect(() => {
    if (window.location.hash === "#create-record" && !initialFragmentHandled.current) {
      initialFragmentHandled.current = true;
      setCreating(true);
    }
  }, []);

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

  if (view === "BOARD" || view === "NOTES") {
    // Keep original view for BOARD and NOTES
    const typedRecords = records as (TodoView | NoteView)[];
    return <main className="command-shell saved-records"><AppNavigation current={view} /><section className="command-main">
      <section className="command-hero"><div><h1>{recordTitles[view]}</h1><p>{view === "BOARD" ? "Add a task, choose who it is for, and mark it complete when it is done." : "Leave a message for a person or the whole System. Your saved notes are below."}</p><a className="command-button" href="#create-record">{view === "BOARD" ? "Add a todo" : "Leave a note"}</a></div></section>
      <p className="command-notice" role="status" aria-live="polite">{state === "loading" ? "Loading saved records…" : notice}</p>
      {state === "unauthorized" ? <p><a href="/auth/login">Sign in to view your saved records</a></p> : state === "error" ? <button className="command-button" onClick={refreshRecords}>Retry records</button> : null}
      {state === "ready" ? <>
        <section id="saved-records" className="command-section" aria-label={`Saved ${recordTitles[view]}`}>
          <h2>Saved {view === "BOARD" ? "todos" : "notes"}</h2><button className="command-button secondary" disabled={busy || refreshing} onClick={refreshRecords}>{refreshing ? "Refreshing records…" : "Refresh records"}</button>
          {!typedRecords.length ? <p className="command-empty">No saved {view === "BOARD" ? "todos" : "notes"} yet. Use the button above to add your first one.</p> : null}
          <div className="command-items">{typedRecords.map((record) => <article className="command-row" id={`record-${record.id}`} key={record.id}><div className="command-row-content">
            {"body" in record ? <><h3>Note for {record.alterName ?? (record.alterId ? "a linked profile" : "System-wide")}</h3><p style={{ whiteSpace: "pre-wrap" }}>{record.body}</p>{record.actorAlterName ? <p>From {record.actorAlterName}</p> : null}</> : <><h3>{record.title}</h3><p>{record.status.toLowerCase().replaceAll("_", " ")} · {record.priority?.toLowerCase() ?? "normal"} priority</p>{record.details ? <p style={{ whiteSpace: "pre-wrap" }}>{record.details}</p> : null}<p>Assigned to: {record.assigneeAlterIds.length ? record.assigneeAlterIds.map((id: string) => profiles.find((profile) => profile.id === id)?.name ?? "Linked profile").join(", ") : "System-wide"}</p>{record.dueOn ? <p>Due {record.dueOn}</p> : null}<button className="command-button" disabled={busy || refreshing} onClick={() => changeRecord(record as TodoView)}>{"status" in record && record.status === "DONE" ? "Reopen todo" : "Mark todo complete"}</button></>}
            <p className="command-row-meta">Updated {formatTimestamp(record.updatedAt)}</p>
          </div></article>)}</div>
          {cursor ? <button className="command-button" disabled={busy || refreshing} onClick={loadMore}>Load more</button> : null}
        </section>
        {profilesReady ? <CreateRecordPanel view={view} refreshing={refreshing} profiles={profiles} onNotice={setNotice} onSaved={refreshRecords} /> : profileError ? <p>{profileError} <button className="command-button" onClick={refreshRecords}>Retry profiles</button></p> : <p>Loading recipient choices…</p>}
      </> : null}
    </section></main>;
  }

  if (view === "THREADS") {
    return <main className="app-page"><AppNavigation current="THREADS" />
      <ListDetail
        title="Threads"
        count={threadRecords.length ? `${threadRecords.length} saved` : undefined}
        newAction={{ label: "Save a thread", onClick: () => setCreating(true), pressed: creating }}
        rows={threadRows}
        selectedId={selectedId}
        onSelect={select}
        listStatus={
          <>
            <p className="command-notice" role="status" aria-live="polite">{state === "loading" ? "Loading saved records…" : notice}</p>
            {state === "unauthorized" && <p><a href="/auth/login">Sign in to view your saved records</a></p>}
            {state === "error" && <button className="command-button" onClick={refreshRecords}>Retry records</button>}
            {state === "ready" && !threadRecords.length && <p className="command-empty">No saved threads yet. Use the button above to add your first one.</p>}
          </>
        }
        detailOpen={creating}
      >
        {threadRowsCurrent ? (
          <article className="detail-card" id={`record-${threadRowsCurrent.id}`}>
            <span className="detail-eyebrow">{threadRowsCurrent.source}</span>
            <h2>{threadRowsCurrent.title}</h2>
            <div className="detail-facts">
              <div><dt>Status</dt><dd>{threadRowsCurrent.status === "CONFIRMED" ? "Confirmed for catch-up" : "Suggestion — not yet confirmed"}</dd></div>
            </div>
            <div>
              <span className="detail-eyebrow">Approved summary</span>
              <p>{threadRowsCurrent.approvedSummary}</p>
            </div>
            <div>
              <span className="detail-eyebrow">Key decision or action</span>
              <p>{threadRowsCurrent.keyDecisionOrAction}</p>
            </div>
            <div className="detail-actions">
              <a className="command-button" href={threadRowsCurrent.url} target="_blank" rel="noreferrer">Open thread</a>
              {threadRowsCurrent.status === "SUGGESTED" && (
                <button className="command-button" disabled={busy || refreshing} onClick={() => changeRecord(threadRowsCurrent)}>Confirm this summary and action</button>
              )}
            </div>
            <p>Review the saved summary and action before confirming it for catch-up. No transcript is stored.</p>
          </article>
        ) : creating ? (
          <CreateRecordPanel view="THREADS" refreshing={refreshing} profiles={profiles} onNotice={setNotice} onSaved={() => { setCreating(false); refreshRecords(); }} />
        ) : null}
      </ListDetail>
    </main>;
  }

  return null;
}
