"use client";
import { useEffect, useState } from "react";
import { AppNavigation } from "../app-navigation";
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
  useEffect(() => { if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView(); }, [records]);
  return <main className="shell"><AppNavigation /><h1>Decisions</h1><p role="status">{notice}</p>{notice && <button onClick={() => setAttempt(a => a + 1)}>Refresh decisions</button>}{records.map(record => <article className="panel" key={record.id} id={`record-${record.id}`}><h2>{record.title}</h2><p className="review-prose">{record.decision}</p>{record.rationale && <p>{record.rationale}</p>}<p><strong>Next:</strong> {record.nextAction}</p></article>)}</main>;
}
