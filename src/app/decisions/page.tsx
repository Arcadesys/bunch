"use client";
import { useEffect, useMemo, useState } from "react";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection } from "../list-detail";
type Decision = { id: string; title: string; decision: string; rationale?: string; nextAction: string };
export default function DecisionsPage() {
  const [records, setRecords] = useState<Decision[]>([]);
  const [notice, setNotice] = useState("Loading decisions…");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/decisions", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Unable to load decisions.");
      setRecords(payload.data); setNotice(payload.data.length ? "" : "No decisions recorded.");
    }).catch(error => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => controller.abort();
  }, [attempt]);
  const ids = useMemo(() => records.map(record => record.id), [records]);
  const [selectedId, select] = useListSelection(ids);
  // Catch-up links to /decisions#record-<id>; open that record.
  useEffect(() => {
    const hashId = window.location.hash.startsWith("#record-") ? window.location.hash.slice("#record-".length) : "";
    if (hashId && ids.includes(hashId)) select(hashId);
  }, [ids, select]);
  const current = records.find(record => record.id === selectedId);
  return <main className="app-page"><AppNavigation current="DECISIONS" />
    <ListDetail title="Decisions" count={records.length ? `${records.length} recorded` : undefined}
      rows={records.map(record => ({ id: record.id, title: record.title, snippet: record.decision }))}
      selectedId={selectedId} onSelect={select}
      listStatus={notice ? <div className="ld-intro"><p role="status">{notice}</p><button className="button button-secondary" onClick={() => setAttempt(a => a + 1)}>Refresh decisions</button></div> : null}>
      {current ? <article className="detail-card" id={`record-${current.id}`}>
        <span className="detail-eyebrow">Decision</span>
        <h2>{current.title}</h2>
        <p className="review-prose">{current.decision}</p>
        {current.rationale && <p>{current.rationale}</p>}
        <div className="detail-callout"><span className="detail-eyebrow">Next</span><p><strong>Next:</strong> {current.nextAction}</p></div>
      </article> : null}
    </ListDetail>
  </main>;
}
