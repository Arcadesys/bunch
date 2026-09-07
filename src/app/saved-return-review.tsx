"use client";
import { useEffect, useState } from "react";
import type { z } from "zod";
import type { conversationSummarySchema } from "@/domain/conversation-summary";
type Review = z.infer<typeof conversationSummarySchema>;
export function SavedReturnReview({ sessionId }: { sessionId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [status, setStatus] = useState("Reading saved review…");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/catch-up/review?sessionId=${encodeURIComponent(sessionId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error?.message ?? "Unable to read saved review."); return payload.data.review as Review | null; })
      .then(data => { if (!controller.signal.aborted) { setReview(data); setStatus(data ? "" : "Review not yet saved."); } })
      .catch(error => { if (!controller.signal.aborted) setStatus(error.message); });
    return () => controller.abort();
  }, [sessionId, attempt]);
  return <section className="return-review" aria-labelledby="return-review-heading">
    <p className="command-kicker">Your return review</p><h2 id="return-review-heading">Catch up at your pace</h2>
    {status && <p role="status">{status}</p>}
    {review ? <><p className="review-prose">{review.summary}</p><h3>Sources and coverage gaps</h3><p className="review-prose">{review.coverage}</p>
      {review.sourceReferences?.length ? <ul>{review.sourceReferences.map((source, i) => <li key={i}><strong>{source.kind === "DIDDY" ? "Bunch record" : source.kind === "MEMORY" ? "ChatGPT memory" : "Conversation context"}:</strong> {source.reference}</li>)}</ul> : null}
      <p className="small">Saved {new Date(review.createdAt).toLocaleString()}{review.sourceClient ? ` · ${review.sourceClient}` : ""}. Expires {new Date(review.expiresAt).toLocaleString()}.</p>
    </> : <p>The saved-record briefing above is still available. ChatGPT can save a review using its available context; missing context remains a coverage gap.</p>}
    <p className="small">Reading this review changes no notes, todos, or review states.</p>
    <button className="command-button secondary" onClick={() => setAttempt(value => value + 1)}>Refresh saved review</button>
  </section>;
}
