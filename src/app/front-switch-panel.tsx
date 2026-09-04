"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import type { CatchUpSession } from "@/domain/catch-up";
import type { FrontingSessionView } from "@/domain/contracts";

type Profile = { id: string; name: string };
type SwitchAttempt = {
  requestId: string;
  body: { alterId: string; expectedCurrentVersion: number | null; expectedCurrentSessionId: string | null };
};

async function read<T>(url: string, signal: AbortSignal): Promise<{ data: T; meta?: { nextCursor?: string } }> {
  const response = await fetch(url, { cache: "no-store", signal, headers: { "x-system-demo": "local" } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? "Unable to read private records.");
  return payload;
}

async function allProfiles(signal: AbortSignal) {
  const profiles: Profile[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await read<Profile[]>(`/api/v1/alters?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, signal);
    profiles.push(...page.data);
    cursor = page.meta?.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Unable to finish loading profiles. Try again.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return profiles;
}

export function FrontSwitchPanel({ onConfirmed, onNotice }: {
  onConfirmed: (session: CatchUpSession | null) => void;
  onNotice: (notice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [current, setCurrent] = useState<FrontingSessionView | null>(null);
  const [selected, setSelected] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  const attempt = useRef<SwitchAttempt | null>(null);
  const submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) trigger.current?.focus();
      restoreFocus.current = false;
      return;
    }
    const controller = new AbortController();
    heading.current?.focus();
    void Promise.all([
      read<FrontingSessionView | null>("/api/v1/fronting/current", controller.signal),
      allProfiles(controller.signal),
    ]).then(([front, available]) => {
      if (controller.signal.aborted) return;
      setCurrent(front.data);
      setProfiles(available);
      setReady(true);
      setMessage(available.length ? "Choose who is fronting, then explicitly confirm." : "No profiles are available. Add a profile before switching.");
    }).catch((error) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Unable to load switch controls.");
    });
    return () => controller.abort();
  }, [open, loadKey]);

  function start() {
    setReady(false);
    setSelected("");
    setMessage("Loading confirmed front and profiles…");
    setOpen(true);
  }

  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !ready || !selected) return;
    submitting.current = true;
    setBusy(true);
    const pending = attempt.current ?? {
      requestId: crypto.randomUUID(),
      body: { alterId: selected, expectedCurrentVersion: current?.version ?? null, expectedCurrentSessionId: current?.id ?? null },
    };
    attempt.current = pending;
    setMessage("Recording your confirmed switch…");
    try {
      const response = await fetch("/api/v1/fronting/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": pending.requestId, "x-system-demo": "local" },
        body: JSON.stringify(pending.body),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status < 500) {
          attempt.current = null;
          setUncertain(false);
          if (response.status === 409) {
            setReady(false);
            setSelected("");
            setMessage("The front changed. Reload current front, choose again, and confirm.");
          } else {
            if (response.status === 401) setReady(false);
            setMessage(payload.error?.message ?? "Unable to record this switch.");
          }
          return;
        }
        throw new Error("Uncertain response");
      }
      // This response is authoritative; opening/choosing never changes the front.
      onConfirmed(payload.data.catchUp ?? null);
      onNotice(`${payload.data.current.alterName} is now the recorded current front.`);
      attempt.current = null;
      setUncertain(false);
      close();
    } catch {
      setUncertain(true);
      setMessage("The switch may have been recorded, but confirmation was not received. Retry this same switch safely; do not submit a different switch yet.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <div className="command-switch">
    <button ref={trigger} type="button" className="command-action" aria-expanded={open} aria-controls="front-switch-form" onClick={start} disabled={open}>Switch front</button>
    {open ? <section id="front-switch-form" className="command-create" aria-labelledby="front-switch-heading">
      <h2 id="front-switch-heading" ref={heading} tabIndex={-1}>Confirm front switch</h2>
      <p aria-live="polite">{message}</p>
      {ready ? <>
        <p>{current ? `Recorded current front: ${current.alterName}` : "No current front is recorded."}</p>
        <form onSubmit={confirm} className="form-stack">
          <label>Who is fronting now?<select required value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy || uncertain}>
            <option value="">Choose a profile</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select></label>
          <button className="command-button" disabled={busy || !selected}>{uncertain ? "Retry confirmed switch" : "Confirm front switch"}</button>
        </form>
      </> : <button type="button" className="command-button secondary" onClick={() => { setMessage("Loading confirmed front and profiles…"); setLoadKey((key) => key + 1); }}>Reload current front</button>}
      <button type="button" className="command-button secondary" onClick={close} disabled={busy || uncertain}>Cancel</button>
    </section> : null}
  </div>;
}
