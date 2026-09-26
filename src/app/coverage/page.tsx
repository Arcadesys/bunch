"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AlterProfile, CoverageAssignment } from "@/domain/types";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection, initials } from "../list-detail";
import { DraftDetail, ConfirmedDetail } from "./coverage-records";

type SystemState = { profiles: AlterProfile[]; assignments: CoverageAssignment[] };
const demoHeaders = { "Content-Type": "application/json", "x-system-demo": "local" };
const today = new Date().toISOString().slice(0, 10);

function privateImageUrl(storageKey: string) {
  return `/api/system/images/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function systemRequest(method: "GET" | "POST", body?: unknown) {
  const response = await fetch("/api/system", {
    method,
    headers: method === "GET" ? { "x-system-demo": "local" } : demoHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export default function CoveragePage() {
  const [state, setState] = useState<SystemState>({ profiles: [], assignments: [] });
  const [notice, setNotice] = useState("Loading coverage…");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [creating, setCreating] = useState(false);
  const [draftStart, setDraftStart] = useState(today);
  const [draftEnd, setDraftEnd] = useState("");
  const [draftProfileId, setDraftProfileId] = useState("");
  const [sharedContext, setSharedContext] = useState("");

  const load = async (successNotice = "Coverage loaded.") => {
    try {
      const next = await systemRequest("GET");
      setState(next);
      setLoadState("ready");
      setNotice(successNotice);
    } catch (error) {
      setLoadState("error");
      setNotice(error instanceof Error ? error.message : "Unable to load coverage.");
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  const drafts = useMemo(
    () => state.assignments.filter((assignment) => assignment.status === "DRAFT"),
    [state]
  );
  const confirmed = useMemo(
    () => state.assignments.filter((assignment) => assignment.status === "CONFIRMED"),
    [state]
  );

  // Combine for list display
  const assignmentsList = useMemo(() => {
    return [...drafts, ...confirmed];
  }, [drafts, confirmed]);

  const ids = useMemo(() => assignmentsList.map((a) => a.id), [assignmentsList]);
  const [selectedId, select] = useListSelection(ids);
  const current = assignmentsList.find((a) => a.id === selectedId);
  const isDraft = current ? drafts.includes(current) : false;

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    try {
      await systemRequest("POST", {
        action: "createDraft",
        draft: {
          startsOn: draftStart,
          endsOn: draftEnd || undefined,
          manualAlterId: draftProfileId || undefined,
          sharedContext: sharedContext || undefined,
        },
      });
      setSharedContext("");
      setDraftStart(today);
      setDraftEnd("");
      setDraftProfileId("");
      setCreating(false);
      await load("Coverage draft created. Review it before confirming.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create draft.");
    }
  }

  async function resolveDraft(
    draftId: string,
    result: "CONFIRMED" | "REJECTED",
    alterId?: string
  ) {
    try {
      await systemRequest("POST", {
        action: "resolveDraft",
        resolution: { draftId, result, alterId },
      });
      select(null);
      await load(
        result === "CONFIRMED"
          ? "Coverage confirmed and saved to coverage history."
          : "Coverage draft rejected."
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to resolve draft.");
    }
  }

  const rows = assignmentsList.map((assignment) => {
    const isDraft = drafts.includes(assignment);
    const profile = state.profiles.find((p) => p.id === assignment.alterId);

    if (isDraft) {
      return {
        id: assignment.id,
        title: `${assignment.startsOn}${assignment.endsOn ? ` – ${assignment.endsOn}` : " onward"}`,
        meta: "Draft",
        badge: { label: "Needs decision", tone: "attention" as const },
        group: "Drafts awaiting your decision",
      };
    }

    const img = profile?.profilePicture?.storageKey;
    return {
      id: assignment.id,
      title: `${assignment.startsOn}${assignment.endsOn ? ` – ${assignment.endsOn}` : " onward"}`,
      meta: profile?.name || "Recorded alter",
      avatar: {
        src: img ? privateImageUrl(img) : null,
        initials: profile ? initials(profile.name) : "?",
      },
      group: "Confirmed coverage history",
    };
  });

  const draftCount = drafts.length;

  return (
    <main className="app-page">
      <AppNavigation current="COVERAGE" />
      {notice && <p className="notice" role="status">{notice}</p>}
      <ListDetail
        title="Coverage"
        count={draftCount ? `${draftCount} draft${draftCount === 1 ? "" : "s"}` : undefined}
        rows={rows}
        selectedId={selectedId}
        onSelect={select}
        newAction={{ label: "Create a coverage draft", onClick: () => setCreating(true), pressed: creating }}
        detailOpen={creating}
        listStatus={
          loadState === "error" ? (
            <div className="ld-intro">
              <button className="button button-secondary" onClick={() => void load()}>
                Retry loading coverage
              </button>
            </div>
          ) : null
        }
      >
        {creating ? (
          <article className="detail-card">
            <span className="detail-eyebrow">Create</span>
            <h2>Coverage draft</h2>
            <p className="small">
              Include a check-in or shared context only if you want it considered for this suggestion.
            </p>
            <form onSubmit={createDraft} className="form-stack">
              <label>
                Starts on
                <input
                  type="date"
                  value={draftStart}
                  onChange={(event) => setDraftStart(event.target.value)}
                  required
                />
              </label>
              <label>
                Ends on <span className="optional">optional</span>
                <input
                  type="date"
                  value={draftEnd}
                  min={draftStart}
                  onChange={(event) => setDraftEnd(event.target.value)}
                />
              </label>
              <label>
                Manual check-in <span className="optional">optional</span>
                <select value={draftProfileId} onChange={(event) => setDraftProfileId(event.target.value)}>
                  <option value="">No selection</option>
                  {state.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shared ChatGPT context <span className="optional">optional</span>
                <textarea
                  value={sharedContext}
                  onChange={(event) => setSharedContext(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="A short note you choose to share for this suggestion only"
                />
              </label>
              <div className="detail-actions">
                <button className="button" type="submit">
                  Create coverage draft
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
            <p className="small">
              Coverage is recorded separately from current front. A draft becomes coverage history only
              when you confirm it.
            </p>
          </article>
        ) : current ? (
          <article className="detail-card">
            {isDraft ? (
              <>
                <span className="detail-eyebrow">Draft</span>
                <h2>{`${current.startsOn}${current.endsOn ? ` – ${current.endsOn}` : " onward"}`}</h2>
                <div className="detail-facts">
                  <div>
                    <dt>Why it was suggested</dt>
                    <dd>
                      <ul>
                        {current.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </div>
                <DraftDetail
                  draft={current}
                  profiles={state.profiles}
                  onResolve={resolveDraft}
                />
                <p className="small">
                  Coverage is recorded separately from current front. A draft becomes coverage history
                  only when you confirm it.
                </p>
              </>
            ) : (
              <>
                <span className="detail-eyebrow">Confirmed</span>
                <h2>{`${current.startsOn}${current.endsOn ? ` – ${current.endsOn}` : " onward"}`}</h2>
                <ConfirmedDetail
                  record={current}
                  profiles={state.profiles}
                />
                <p className="small">
                  Coverage is recorded separately from current front. A draft becomes coverage history
                  only when you confirm it.
                </p>
              </>
            )}
          </article>
        ) : null}
      </ListDetail>
    </main>
  );
}

