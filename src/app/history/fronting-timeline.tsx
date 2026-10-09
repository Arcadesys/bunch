"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection, initials as getInitials, type ListRow } from "../list-detail";
import { frontingHistoryResponseSchema, type FrontingHistoryResponse } from "@/domain/fronting-history";
import "./history.css";

function defaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: day(start), to: day(end) };
}

export function FrontingTimeline() {
  const [result, setResult] = useState<FrontingHistoryResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState(defaultRange);
  const [zone, setZone] = useState("");
  const controller = useRef<AbortController | null>(null);

  async function load(from: string, to: string, before?: NonNullable<FrontingHistoryResponse["meta"]["nextCursor"]>) {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError("");
    if (!before) setResult(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) {
        const end = new Date(`${to}T00:00:00`);
        end.setDate(end.getDate() + 1);
        params.set("to", end.toISOString());
      }
      if (from && to && from > to) throw new Error("Choose an end date on or after the start date.");
      if (before) {
        params.set("beforeStartedAt", before.startedAt);
        params.set("beforeId", before.id);
        params.set("beforeKind", before.kind);
      }
      const response = await fetch(`/api/v1/fronting/history?${params}`, { signal: active.signal, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to see your private timeline." : "Could not load the timeline. Please try again.");
      const next = frontingHistoryResponseSchema.parse(await response.json());
      if (!active.signal.aborted) setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (!active.signal.aborted) setResult(previous => ({ ...next, data: before ? [...(previous?.data ?? []), ...next.data] : next.data }));
    } catch (cause) {
      if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the timeline.");
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    const dates = defaultRange();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(dates.from, dates.to);
    return () => controller.current?.abort();
  }, []);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const next = { from: String(fields.get("from") ?? ""), to: String(fields.get("to") ?? "") };
    setRange(next);
    void load(next.from, next.to);
  }

  const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const clock = (value: string) => new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const rows = useMemo<ListRow[]>(() => (result?.data ?? []).map(record => {
    const groupDate = new Date(record.startedAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    return {
      id: recordId(record),
      title: record.alterName,
      meta: `${clock(record.startedAt)}${record.endedAt ? ` – ${clock(record.endedAt)}` : " · no end recorded"}`,
      avatar: { initials: getInitials(record.alterName) },
      badge: { label: kindShort(record.kind), tone: record.kind === "HOSTING" ? "host" : record.kind === "FRONTING" ? "also" : "neutral" },
      group: groupDate,
    };
  }), [result?.data]);

  const ids = useMemo(() => rows.map(row => row.id), [rows]);
  const [selectedId, select] = useListSelection(ids);
  const current = result?.data.find(record => recordId(record) === selectedId);

  const listStatus = <>
    <p role="status" className="history-summary">{busy ? "Loading recorded history…" : result ? `${result.data.length} recorded ${result.data.length === 1 ? "session" : "sessions"} shown${result.meta.nextCursor ? " · More available" : ""}.` : ""}</p>
    {error ? <div role="alert" className="ld-intro"><p>{error}</p><button type="button" className="button button-secondary history-retry" onClick={() => void load(range.from, range.to)}>Retry</button></div> : null}
    {result && !result.data.length ? <p className="ld-intro">No recorded fronting sessions match these dates.</p> : null}
  </>;

  const filterTools = <form onSubmit={filter} className="history-filters">
    <label>From date<input type="date" name="from" defaultValue={range.from} /></label>
    <label>Through date<input type="date" name="to" defaultValue={range.to} /></label>
    <button type="submit" disabled={busy} className="button button-secondary">Show timeline</button>
  </form>;

  const intro = <div className="history-intro">
    <p>Showing seven days by default. Choose broader dates below; this never limits a return catch-up.</p>
    <p>Hosting periods and fronting episodes, newest first. Times are shown in {zone || "your local timezone"}.</p>
    <p>Only confirmed records appear here. Gaps do not establish anyone’s absence.</p>
  </div>;

  const footer = result?.meta.nextCursor ? <div className="history-load-older"><button type="button" disabled={busy} onClick={() => void load(range.from, range.to, result.meta.nextCursor)} className="button button-secondary">Load older records</button></div> : null;

  return <main className="app-page"><AppNavigation current="HISTORY" />
    <ListDetail title="History" count="Recorded only" intro={intro} rows={rows} selectedId={current ? selectedId : null} onSelect={select}
      listStatus={listStatus} listTools={filterTools} listFooter={footer} detailLabel="Recorded period"
      emptyDetail={<p className="ld-empty">{busy ? "Loading recorded history…" : "Choose a recorded period from the list."}</p>}>
      {current ? <article className="detail-card">
        <div className="history-detail-header">
          <span className="ld-avatar" aria-hidden="true"><span>{getInitials(current.alterName)}</span></span>
          <div className="history-name-section">
            <h2>{current.alterName}</h2>
            <p className="history-kind"><strong>{kindLabel(current.kind)}</strong></p>
          </div>
        </div>
        {current.kind === "HOSTING" ? <p>Responsible for everything otherwise unclaimed during this period.</p> : null}
        {current.origin === "SYSTEM_HOST_SNAPSHOT" ? <p>Start based on the previously recorded host timestamp.</p> : null}
        <dl className="detail-facts">
          <div><dt>From</dt><dd><time dateTime={current.startedAt}>{stamp(current.startedAt)}</time></dd></div>
          <div><dt>To</dt><dd>{current.endedAt ? <time dateTime={current.endedAt}>{stamp(current.endedAt)}</time> : <strong>{current.kind === "HOSTING" ? "Hosting · no end recorded" : current.kind === "FRONTING" ? "Fronting · no end recorded" : "Legacy record · no end recorded"}</strong>}</dd></div>
          {current.energy || current.trigger ? <div><dt>Reported at arrival</dt><dd>{[current.energy ? `energy ${current.energy} of 5` : "", current.trigger ?? ""].filter(Boolean).join(" · ")}</dd></div> : null}
        </dl>
        <p className="history-callout">Ask Bunch: “Who was out yesterday?” or “When was [name] last out?”</p>
      </article> : null}
    </ListDetail>
  </main>;
}

type HistoryRecord = FrontingHistoryResponse["data"][number];

function recordId(record: HistoryRecord) {
  return `${record.kind}:${record.id}`;
}

function kindLabel(kind: HistoryRecord["kind"]) {
  return kind === "HOSTING" ? "Hosting" : kind === "FRONTING" ? "Fronting" : "Legacy front record · kind not classified";
}

function kindShort(kind: HistoryRecord["kind"]) {
  return kind === "HOSTING" ? "Hosting" : kind === "FRONTING" ? "Fronting" : "Legacy";
}
