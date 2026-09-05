"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PresencePeriod } from "@/domain/presence";
import type { SystemHostView } from "@/domain/host";
type Profile = { id: string; name: string };
type Action = "HOST" | "START" | "CLEAR" | "END";
type Attempt = {
  requestId: string;
  url: string;
  body: Record<string, unknown>;
  action: Action;
};
async function read<T>(
  url: string,
  signal: AbortSignal,
): Promise<{ data: T; meta?: { nextCursor?: string } }> {
  const response = await fetch(url, {
    cache: "no-store",
    signal,
    headers: { "x-system-demo": "local" },
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.error?.message ?? "Unable to read private records.",
    );
  return payload;
}

async function allProfiles(signal: AbortSignal) {
  const profiles: Profile[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await read<Profile[]>(
      `/api/v1/alters?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      signal,
    );
    profiles.push(...page.data);
    cursor = page.meta?.nextCursor;
    if (cursor && seen.has(cursor))
      throw new Error("Unable to finish loading profiles. Try again.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return profiles;
}

export function FrontSwitchPanel({
  onConfirmed,
  onNotice,
}: {
  onConfirmed: (periodId?: string) => void;
  onNotice: (notice: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const [uncertain, setUncertain] = useState(false),
    [reload, setReload] = useState(0);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [host, setHost] = useState<SystemHostView | null>(null);
  const [presence, setPresence] = useState<{
    hosting: PresencePeriod | null;
    fronting: PresencePeriod[];
  }>({ hosting: null, fronting: [] });
  const [action, setAction] = useState<Action>("START"),
    [selected, setSelected] = useState(""),
    [message, setMessage] = useState("");
  const attempt = useRef<Attempt | null>(null),
    submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (!open) {
      if (restoreFocus.current) trigger.current?.focus();
      restoreFocus.current = false;
      return;
    }
    heading.current?.focus();
    const controller = new AbortController();
    void Promise.all([
      allProfiles(controller.signal),
      read<SystemHostView | null>("/api/v1/hosting/current", controller.signal),
      read<typeof presence>("/api/v1/presence/current", controller.signal),
    ])
      .then(([ps, h, p]) => {
        if (!controller.signal.aborted) {
          setProfiles(ps);
          setHost(h.data);
          setPresence(p.data);
          setReady(true);
          setMessage(
            "Choose the experience and explicitly confirm the change.",
          );
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setMessage(e.message || "Unable to load records.");
      });
    return () => controller.abort();
  }, [open, reload]);
  function close() {
    restoreFocus.current = true;
    setOpen(false);
  }
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !ready) return;
    const episode = presence.fronting.find((p) => p.id === selected);
    if (
      !attempt.current &&
      ((action !== "CLEAR" && !selected) || (action === "END" && !episode))
    )
      return;
    const pending = attempt.current ?? {
      requestId: crypto.randomUUID(),
      action,
      url:
        action === "HOST" || action === "CLEAR"
          ? "/api/v1/hosting/current"
          : `/api/v1/presence/fronting/${action === "START" ? "start" : "end"}`,
      body:
        action === "HOST" || action === "CLEAR"
          ? {
              alterId: action === "CLEAR" ? null : selected,
              expectedVersion: host?.version ?? null,
            }
          : action === "START"
            ? { alterId: selected }
            : { episodeId: selected, expectedVersion: episode!.version },
    };
    attempt.current = pending;
    submitting.current = true;
    setBusy(true);
    setMessage("Recording your confirmed change…");
    try {
      const response = await fetch(pending.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.requestId,
        },
        body: JSON.stringify(pending.body),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status >= 500) throw new Error("Uncertain response");
        attempt.current = null;
        setUncertain(false);
        setReady(false);
        setSelected("");
        setMessage(
          response.status === 409
            ? "The record changed. Reload, choose again, and confirm."
            : (payload.error?.message ?? "Unable to record change."),
        );
        return;
      }
      attempt.current = null;
      setUncertain(false);
      // Catch-up reads are separate: a read failure must never replay this write.
      let periodId: string | undefined;
      if (pending.action === "START") periodId = payload.data.id;
      if (pending.action === "HOST") {
        try {
          const p = await read<typeof presence>(
            "/api/v1/presence/current",
            new AbortController().signal,
          );
          periodId = p.data.hosting?.id;
        } catch {
          /* The confirmed host is saved; refresh can recover its catch-up. */
        }
      }
      onConfirmed(periodId);
      onNotice(
        pending.action === "HOST"
          ? "Hosting recorded. Fronting episodes continue independently."
          : pending.action === "CLEAR"
            ? "Hosting ended. Fronting episodes continue independently."
            : pending.action === "START"
              ? "Fronting episode recorded. Hosting is unchanged."
              : "Fronting episode ended. Hosting and other episodes are unchanged.",
      );
      close();
    } catch {
      setUncertain(true);
      setMessage(
        "The change may be saved. Retry the same confirmed change safely before choosing another.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const choices =
    action === "END"
      ? presence.fronting.map((p) => ({ id: p.id, name: p.alterName }))
      : profiles;
  return (
    <div className="command-switch">
      <button
        ref={trigger}
        className="command-action"
        aria-expanded={open}
        onClick={() => {
          setReady(false);
          setSelected("");
          setMessage("Loading recorded hosting and fronting…");
          setOpen(true);
        }}
        disabled={open}
      >
        Update hosting or fronting
      </button>
      {open ? (
        <section
          className="command-create"
          aria-labelledby="presence-change-heading"
        >
          <h2 id="presence-change-heading" ref={heading} tabIndex={-1}>
            Confirm hosting or fronting
          </h2>
          <p role="status">{message}</p>
          {ready ? (
            <form className="form-stack" onSubmit={confirm}>
              <label>
                Experience change
                <select
                  value={action}
                  disabled={busy || uncertain}
                  onChange={(e) => {
                    setAction(e.target.value as Action);
                    setSelected("");
                  }}
                >
                  <option value="START">Start fronting episode</option>
                  <option value="END">End fronting episode</option>
                  <option value="HOST">Start hosting</option>
                  <option value="CLEAR">End hosting</option>
                </select>
              </label>
              <p>
                {action === "HOST" || action === "CLEAR"
                  ? `Hosting: ${host?.alterName ?? "not recorded"}. The host is responsible for everything otherwise unclaimed.`
                  : "Fronting episodes can overlap hosting and end independently."}
              </p>
              {action !== "CLEAR" ? (
                <label>
                  {action === "END" ? "Episode to end" : "Profile"}
                  <select
                    aria-label={action === "END" ? "Episode to end" : "Profile"}
                    required
                    value={selected}
                    disabled={busy || uncertain}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">
                      Choose a{" "}
                      {action === "END" ? "recorded episode" : "profile"}
                    </option>
                    {choices.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <button
                className="command-button"
                disabled={
                  busy ||
                  (action !== "CLEAR" && !selected) ||
                  (action === "CLEAR" && !host?.alterId)
                }
              >
                {uncertain ? "Retry confirmed change" : "Confirm change"}
              </button>
            </form>
          ) : (
            <button
              className="command-button secondary"
              onClick={() => setReload((v) => v + 1)}
            >
              Reload hosting and fronting
            </button>
          )}
          <button
            className="command-button secondary"
            onClick={close}
            disabled={busy || uncertain}
          >
            Cancel
          </button>
        </section>
      ) : null}
    </div>
  );
}
