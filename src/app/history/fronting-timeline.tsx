"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection, initials as getInitials } from "../list-detail";
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

  const rows = useMemo(() => {
    const data = result?.data;
    if (!data?.length) return [];
    return data.map(record => {
      const recordDate = new Date(record.startedAt);
      const groupDate = recordDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
      const kindLabel = record.kind === "HOSTING" ? "Hosting" : record.kind === "FRONTING" ? "Fronting" : "Unclassified";
      let tone: "host" | "also" | "neutral";
      if (record.kind === "HOSTING") tone = "host";
      else if (record.kind === "FRONTING") tone = "also";
      else tone = "neutral";
      return {
        id: `${record.kind}:${record.id}`,
        title: record.alterName,
        meta: kindLabel,
        avatar: { initials: getInitials(record.alterName) },
        badge: { label: kindLabel, tone },
        group: groupDate,
      };
    });
  }, [result?.data]);

  const ids = useMemo(() => rows.map(row => row.id), [rows]);
  const [selectedId, select] = useListSelection(ids, { autoSelectFirst: false });
  const current = result?.data.find(record => `${record.kind}:${record.id}` === selectedId);

  const listStatus = busy ? <div className="ld-intro"><p role="status">Loading recorded history...</p></div> : error ? <div className="ld-intro"><div role="alert"><p>{error}</p><button className="button button-secondary" onClick={() => void load(range.from, range.to)}>Retry</button></div></div> : !result?.data.length ? <div className="ld-intro"><p>No recorded fronting sessions match these dates.</p></div> : null;

  const filterTools = <form onSubmit={filter} className="history-filters">
    <label><span className="history-label">From date</span><input type="date" name="from" defaultValue={range.from} /></label>
    <label><span className="history-label">Through date</span><input type="date" name="to" defaultValue={range.to} /></label>
    <button type="submit" disabled={busy} className="button button-secondary">Show timeline</button>
  </form>;

  const intro = <div className="history-intro"><p>Hosting periods and fronting episodes, newest first.</p></div>;

  return <main className="app-page"><AppNavigation current="HISTORY" />
    <ListDetail title="History" intro={intro} rows={rows} selectedId={selectedId} onSelect={select}
      listStatus={listStatus} listTools={result ? filterTools : null}>
      {current ? <article className="detail-card">
        <div className="history-detail-header">
          <span className="ld-avatar">
            <span>{getInitials(current.alterName)}</span>
          </span>
          <div className="history-name-section">
            <h2>{current.alterName}</h2>
            <span className="detail-eyebrow">{current.kind === "HOSTING" ? "Hosting" : current.kind === "FRONTING" ? "Fronting" : "Unclassified"}</span>
          </div>
        </div>
        {current.kind === "HOSTING" ? <p className="history-hosting-note">Responsible for everything otherwise unclaimed during this period.</p> : null}
        <dl className="detail-facts">
          <div><dt>From</dt><dd><time dateTime={current.startedAt}>{stamp(current.startedAt)}</time></dd></div>
          <div><dt>To</dt><dd>{current.endedAt ? <time dateTime={current.endedAt}>{stamp(current.endedAt)}</time> : <span>{current.kind === "HOSTING" ? "Hosting · no end recorded" : current.kind === "FRONTING" ? "Fronting · no end recorded" : "Legacy record · no end recorded"}</span>}</dd></div>
          {current.energy || current.trigger ? <div><dt>Reported at arrival</dt><dd>{[current.energy ? `energy ${current.energy} of 5` : "", current.trigger ?? ""].filter(Boolean).join(" - ")}</dd></div> : null}
        </dl>
        <p className="history-callout">Only confirmed records appear here. Gaps do not establish anyone&apos;s absence.</p>
      </article> : null}
    </ListDetail>
    {result?.meta.nextCursor ? <div className="history-load-older"><button disabled={busy} onClick={() => void load(range.from, range.to, result.meta.nextCursor)} className="button button-secondary">Load older records</button></div> : null}
  </main>;
}
