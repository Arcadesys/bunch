"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AppNavigation } from "../app-navigation";
import { frontingHistoryResponseSchema, type FrontingHistoryResponse } from "@/domain/fronting-history";

export function FrontingTimeline() {
  const [result, setResult] = useState<FrontingHistoryResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [zone, setZone] = useState("");
  const controller = useRef<AbortController | null>(null);

  async function load(from: string, to: string, before?: NonNullable<FrontingHistoryResponse["meta"]["nextCursor"]>) {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true); setError("");
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
      if (before) { params.set("beforeStartedAt", before.startedAt); params.set("beforeId", before.id); params.set("beforeKind", before.kind); }
      const response = await fetch(`/api/v1/fronting/history?${params}`, { signal: active.signal, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "Sign in to see your private timeline." : "Could not load the timeline. Please try again.");
      const next = frontingHistoryResponseSchema.parse(await response.json());
      if (!active.signal.aborted) setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      if (!active.signal.aborted) setResult(previous => ({ ...next, data: before ? [...(previous?.data ?? []), ...next.data] : next.data }));
    } catch (cause) {
      if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the timeline.");
    } finally { if (!active.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    // Bootstrap an abortable external read; subsequent state updates follow its response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load("", "");
    return () => controller.current?.abort();
  }, []);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const next = { from: String(fields.get("from") ?? ""), to: String(fields.get("to") ?? "") };
    setRange(next); void load(next.from, next.to);
  }
  const stamp = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return <div className="command-app"><AppNavigation current="HISTORY" /><main className="fronting-history">
    <h1>Who was out when</h1>
    <p>Hosting periods and fronting episodes, newest first. Times are shown in {zone || "your local timezone"}.</p>
    <p>Only confirmed records appear here. Gaps do not establish anyone’s absence.</p>
    <form onSubmit={filter} className="fronting-filters">
      <label>From date<input type="date" name="from" /></label>
      <label>Through date<input type="date" name="to" /></label>
      <button type="submit" disabled={busy}>Show timeline</button>
    </form>
    <p className="fronting-help">Ask DIDdy: “Who was out yesterday?” or “When was [name] last out?”</p>
    {busy ? <p role="status">Loading recorded history…</p> : null}
    {error ? <div role="alert"><p>{error}</p><button onClick={() => void load(range.from, range.to)}>Retry</button></div> : null}
    {result ? <>
      <p role="status">{result.data.length} recorded {result.data.length === 1 ? "session" : "sessions"} shown{result.meta.nextCursor ? " · More available" : ""}.</p>
      {!result.data.length ? <p>No recorded fronting sessions match these dates.</p> : <ol className="fronting-records" aria-label="Recorded fronting timeline">
        {result.data.map(record => <li key={`${record.kind}:${record.id}`}>
          <h2>{record.alterName}</h2>
          <p><strong>{record.kind === "HOSTING" ? "Hosting" : record.kind === "FRONTING" ? "Fronting" : "Legacy front record · kind not classified"}</strong></p>
          {record.kind === "HOSTING" ? <p>Responsible for everything otherwise unclaimed during this period.</p> : null}
          {record.origin === "SYSTEM_HOST_SNAPSHOT" ? <p>Start based on the previously recorded host timestamp.</p> : null}
          <p><strong>From</strong> <time dateTime={record.startedAt}>{stamp(record.startedAt)}</time></p>
          <p><strong>To</strong> {record.endedAt ? <time dateTime={record.endedAt}>{stamp(record.endedAt)}</time> : <strong>{record.kind === "HOSTING" ? "Hosting · no end recorded" : record.kind === "FRONTING" ? "Fronting · no end recorded" : "Legacy record · no end recorded"}</strong>}</p>
        </li>)}
      </ol>}
      {result.meta.nextCursor ? <button disabled={busy} onClick={() => void load(range.from, range.to, result.meta.nextCursor)}>Load older records</button> : null}
    </> : null}
  </main></div>;
}
