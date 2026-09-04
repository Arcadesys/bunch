"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { FrontingSessionView } from "@/domain/contracts";
import type { AlterProfile, CoverageAssignment } from "@/domain/types";
import { ThemeControl } from "./theme-control";

type SystemState = { currentFront: FrontingSessionView | null; profiles: AlterProfile[]; assignments: CoverageAssignment[] };
const demoHeaders = { "Content-Type": "application/json", "x-system-demo": "local" };
const today = new Date().toISOString().slice(0, 10);

function privateImageUrl(storageKey: string) {
  return `/api/system/images/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function systemRequest(method: "GET" | "POST", body?: unknown) {
  const response = await fetch("/api/system", { method, headers: method === "GET" ? { "x-system-demo": "local" } : demoHeaders, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export function ProfileManagement() {
  const [state, setState] = useState<SystemState>({ currentFront: null, profiles: [], assignments: [] });
  const [notice, setNotice] = useState("Loading your private local walkthrough…");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [draftStart, setDraftStart] = useState(today);
  const [draftEnd, setDraftEnd] = useState("");
  const [draftProfileId, setDraftProfileId] = useState("");
  const [sharedContext, setSharedContext] = useState("");

  const load = async () => {
    try {
      const next = await systemRequest("GET");
      setState(next);
      setNotice("Private local walkthrough ready. Nothing here is a diagnosis or a prediction.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to load private records."); }
  };
  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  const drafts = useMemo(() => state.assignments.filter((assignment) => assignment.status === "DRAFT"), [state]);
  const confirmed = useMemo(() => state.assignments.filter((assignment) => assignment.status === "CONFIRMED"), [state]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await systemRequest("POST", { action: "saveProfile", profileId: selectedProfileId || undefined, profile: { name: form.get("name"), selfDescribedGender: form.get("gender"), description: form.get("description") } });
      formElement.reset();
      setSelectedProfileId("");
      setNotice("Profile saved privately.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save profile."); }
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/system/images", { method: "POST", headers: { "x-system-demo": "local" }, body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      formElement.reset();
      setNotice("Image stored in the private local store.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to upload image."); }
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    try {
      await systemRequest("POST", { action: "createDraft", draft: { startsOn: draftStart, endsOn: draftEnd || undefined, manualAlterId: draftProfileId || undefined, sharedContext: sharedContext || undefined } });
      setSharedContext("");
      setNotice("Draft created. It is not history until you confirm it.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to create draft."); }
  }

  async function resolveDraft(draftId: string, result: "CONFIRMED" | "REJECTED", alterId?: string) {
    try {
      await systemRequest("POST", { action: "resolveDraft", resolution: { draftId, result, alterId } });
      setNotice(result === "CONFIRMED" ? "Confirmed. This is now recorded history." : "Draft rejected. It will not appear in history or ChatGPT.");
      await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to resolve draft."); }
  }

  return <main className="shell">
    <header className="site-header"><div><p className="eyebrow">System · private coverage record</p><h1>Keep the record yours.</h1></div><div className="header-actions"><ThemeControl /><a className="button button-secondary" href="/auth/login">Sign in with Google</a></div></header>
    <p className="notice" role="status">{notice}</p>

    <section className="current-front" aria-labelledby="current-front-heading">
      <p className="eyebrow">Confirmed now</p>
      <h2 id="current-front-heading">Current front</h2>
      {state.currentFront ? <><p className="current-front-name">{state.currentFront.alterName}</p><p className="small">Recorded since {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.currentFront.startedAt))}</p></> : <p>No current front is recorded yet.</p>}
    </section>

    <section className="intro" aria-labelledby="scope-heading"><h2 id="scope-heading">This first slice</h2><p>Profiles and draft coverage are private. A suggestion is a starting point only; you inspect it and choose whether it becomes a confirmed record.</p></section>

    <div className="columns">
      <section className="panel" aria-labelledby="profiles-heading"><h2 id="profiles-heading">Alter profiles</h2>
        <form onSubmit={saveProfile} className="form-stack"><label>Name<input required name="name" maxLength={120} defaultValue={state.profiles.find((profile) => profile.id === selectedProfileId)?.name || ""} /></label><label>Self-described gender <span className="optional">optional</span><input name="gender" maxLength={120} defaultValue={state.profiles.find((profile) => profile.id === selectedProfileId)?.selfDescribedGender || ""} /></label><label>Description <span className="optional">optional</span><textarea name="description" maxLength={1000} rows={3} defaultValue={state.profiles.find((profile) => profile.id === selectedProfileId)?.description || ""} /></label><button className="button" type="submit">{selectedProfileId ? "Save changes" : "Add private profile"}</button></form>
        {state.profiles.length > 0 && <ul className="profile-list">{state.profiles.map((profile) => <li key={profile.id}>
          <div className="profile-entry">
            {profile.images.length > 0 && <div className="profile-images" aria-label={`Private images for ${profile.name}`}>
              {profile.images.map((image) => <Image key={image.id} className="profile-image" src={privateImageUrl(image.storageKey)} alt={`Portrait for ${profile.name}`} width={240} height={240} sizes="(max-width: 800px) 70vw, 240px" unoptimized />)}
            </div>}
            <div className="profile-summary"><strong>{profile.name}</strong>{profile.selfDescribedGender && <span> · {profile.selfDescribedGender}</span>}<p>{profile.description || "No description added."}</p><p className="small">{profile.images.length} private image{profile.images.length === 1 ? "" : "s"}</p></div>
          </div>
          <button className="text-button" type="button" onClick={() => setSelectedProfileId(profile.id)}>Edit</button>
        </li>)}</ul>}
        {state.profiles.length > 0 && <form onSubmit={uploadImage} className="upload-form"><label>Attach a private image<select required name="alterId" defaultValue=""><option value="" disabled>Choose a profile</option>{state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label>Image file<input required name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><button className="button button-secondary" type="submit">Store private image</button></form>}
      </section>

      <section className="panel" aria-labelledby="coverage-heading"><h2 id="coverage-heading">Coverage draft</h2><p className="small">Use the check-in only if you want it considered. Shared ChatGPT context is limited to this suggestion and is not retained.</p>
        <form onSubmit={createDraft} className="form-stack"><label>Starts on<input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} required /></label><label>Ends on <span className="optional">optional</span><input type="date" value={draftEnd} min={draftStart} onChange={(event) => setDraftEnd(event.target.value)} /></label><label>Optional manual check-in<select value={draftProfileId} onChange={(event) => setDraftProfileId(event.target.value)}><option value="">No selection</option>{state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label>Optional explicitly shared ChatGPT context<textarea value={sharedContext} onChange={(event) => setSharedContext(event.target.value)} maxLength={500} rows={3} placeholder="A short note you choose to share for this suggestion only" /></label><button className="button" type="submit">Create inspectable draft</button></form>
        <div className="records"><h3>Awaiting your decision</h3>{drafts.length === 0 ? <p className="small">No coverage drafts.</p> : drafts.map((draft) => <DraftCard key={draft.id} draft={draft} profiles={state.profiles} onResolve={resolveDraft} />)}<h3>Confirmed history</h3>{confirmed.length === 0 ? <p className="small">Nothing confirmed yet. ChatGPT receives no history until you choose Confirm.</p> : <ul className="history-list">{confirmed.map((record) => <li key={record.id}><strong>{state.profiles.find((profile) => profile.id === record.alterId)?.name || "Recorded alter"}</strong><span>{record.startsOn}{record.endsOn ? ` – ${record.endsOn}` : " onward"}</span></li>)}</ul>}</div>
      </section>
    </div>
  </main>;
}

function DraftCard({ draft, profiles, onResolve }: { draft: CoverageAssignment; profiles: AlterProfile[]; onResolve: (id: string, result: "CONFIRMED" | "REJECTED", alterId?: string) => void }) {
  const [alterId, setAlterId] = useState(draft.alterId || "");
  return <article className="draft-card"><p><strong>Draft: {draft.startsOn}{draft.endsOn ? ` – ${draft.endsOn}` : " onward"}</strong></p><h4>Why it was suggested</h4><ul>{draft.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><label>Record this as<select value={alterId} onChange={(event) => setAlterId(event.target.value)}><option value="">Choose before confirming</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><div className="actions"><button className="button" type="button" onClick={() => onResolve(draft.id, "CONFIRMED", alterId || undefined)}>Confirm as recorded history</button><button className="button button-secondary" type="button" onClick={() => onResolve(draft.id, "REJECTED")}>Reject draft</button></div></article>;
}
