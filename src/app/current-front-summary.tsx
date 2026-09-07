"use client";

import type { CatchUpSession } from "@/domain/catch-up";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PresencePeriod } from "@/domain/presence";

function PresenceCard({
  period,
  onChoose,
}: {
  period: PresencePeriod;
  onChoose: (id: string) => void;
}) {
  const [pictureFailed, setPictureFailed] = useState(false);
  const [checkNotice, setCheckNotice] = useState("");
  const [picture, setPicture] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/alters/${period.alterId}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((payload) => {
        if (!controller.signal.aborted)
          setPicture(payload.data.profilePicture?.id ?? null);
      })
      .catch(() => {
        if (!controller.signal.aborted) { setPicture(null); setPictureFailed(true); }
      });
    return () => controller.abort();
  }, [period.alterId]);
  return (
    <article className="presence-card">
      {picture ? (
        <Image
          src={`/api/system/gallery-images/${encodeURIComponent(picture)}`}
          alt={`Selected profile picture for ${period.alterName}`}
          width={112}
          height={112}
          unoptimized
          onError={() => { setPicture(null); setPictureFailed(true); }}
        />
      ) : null}
      {pictureFailed && <p>Profile picture could not be loaded. <Link href="/gallery">Open authenticated photo gallery</Link>.</p>}
      <h3>{period.alterName}</h3>
      <p>{period.alterName} was last recorded starting {period.kind === "FRONTING" ? "fronting" : "hosting"} <time dateTime={period.startedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" }).format(new Date(period.startedAt))}</time>. No end is recorded.</p>
      {!checkNotice && <details><summary>Still accurate? Optional check</summary><p>Use the hosting and fronting controls to report a change.</p><button onClick={() => setCheckNotice("No changes saved. It’s okay to be unsure.")}>I’m unsure</button><button onClick={() => setCheckNotice("Presence left unchanged.")}>Leave unchanged</button></details>}
      <p role="status">{checkNotice}</p>
      {period.kind === "FRONTING" ? <button
        className="command-button secondary"
        onClick={() => onChoose(period.id)}
      >
        Catch up for {period.alterName} ·{" "}
        fronting
      </button> : null}
    </article>
  );
}

export function CurrentFrontSummary({
  refreshKey,
  onChoose,
  session,
}: {
  session?: CatchUpSession | null;
  refreshKey: number;
  onChoose: (periodId: string) => void;
}) {
  const [state, setState] = useState<{
    hosting: PresencePeriod | null;
    fronting: PresencePeriod[];
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [expanded,setExpanded] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setState(null);
      setError("");
      try {
        const response = await fetch("/api/v1/presence/current", {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? "Sign in to read hosting and fronting."
              : "Hosting and fronting could not be read.",
          );
        const payload = await response.json();
        if (!controller.signal.aborted) {setState(payload.data);if(refreshKey>0)setExpanded(true);}
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Unable to read records.",
          );
      }
    })();
    return () => controller.abort();
  }, [refreshKey, retry]);
  const period = (p: PresencePeriod) => (
    <PresenceCard key={p.id} period={p} onChoose={onChoose} />
  );
  return (
    <details className="presence-overview catch-up-window" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
    <summary>Hosting and fronting</summary>
    <section
      className="current-front-summary"
      aria-labelledby="presence-heading"
    >
      <div>
        <h2 id="presence-heading">Hosting and fronting</h2>
        {session?<p>{session.firstTime?"First catch-up for this experience · addressed items plus urgent System-wide carryover":`Recorded catch-up window: ${session.windowStart?new Date(session.windowStart).toLocaleString():"First record"} to ${new Date(session.windowEnd).toLocaleString()}`}</p>:<p>Catch-up is available for currently fronting people.</p>}
        <Link className="command-button secondary" href="/profiles">Profiles and pictures</Link>
        {error ? (
          <p role="alert">{error}</p>
        ) : !state ? (
          <p role="status">Reading hosting and fronting…</p>
        ) : (
          <>
            <h3>Hosting</h3>
            <p>
              Responsible for everything otherwise unclaimed during this period.
            </p>
            {state.hosting ? (
              period(state.hosting)
            ) : (
              <p>No hosting period is recorded.</p>
            )}
            <h3>Fronting alongside</h3>
            {state.fronting.length ? (
              state.fronting.map(period)
            ) : (
              <p>No open fronting episodes are recorded.</p>
            )}
            <p>
              These are saved reports, not a fresh check of who is here. Episodes stay open until an explicit end is reported. These records do not establish anyone’s absence.
            </p>
          </>
        )}
        <button
          className="command-button secondary"
          onClick={() => setRetry((v) => v + 1)}
        >
          Refresh hosting and fronting
        </button>
      </div>
    </section>
    </details>
  );
}
