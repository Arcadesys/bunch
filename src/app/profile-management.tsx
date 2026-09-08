"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { FrontingSessionView } from "@/domain/contracts";
import type { AlterProfile, CoverageAssignment } from "@/domain/types";
import type { AlterView } from "@/domain/contracts";
import { AppNavigation } from "./app-navigation";

type SystemState = { currentFront: FrontingSessionView | null; profiles: AlterProfile[]; assignments: CoverageAssignment[] };
const demoHeaders = { "Content-Type": "application/json", "x-system-demo": "local" };
const today = new Date().toISOString().slice(0, 10);
function privateImageUrl(storageKey: string) { return `/api/system/images/${storageKey.split("/").map(encodeURIComponent).join("/")}`; }
async function systemRequest(method: "GET" | "POST", body?: unknown) { const response = await fetch("/api/system", { method, headers: method === "GET" ? { "x-system-demo": "local" } : demoHeaders, body: body ? JSON.stringify(body) : undefined }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Request failed."); return data; }

export function ProfileManagement() {
  const [state, setState] = useState<SystemState>({ currentFront: null, profiles: [], assignments: [] });
  const [notice, setNotice] = useState("Loading private profiles…");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [draftStart, setDraftStart] = useState(today);
  const [draftEnd, setDraftEnd] = useState("");
  const [draftProfileId, setDraftProfileId] = useState("");
  const [sharedContext, setSharedContext] = useState("");
  const [appearance, setAppearance] = useState<Record<string, Pick<AlterView, "appearanceNotes" | "appearanceReferenceImageIds" | "version">>>({});
  const saveInFlight = useRef(false);
  const editingVersion = useRef<number | undefined>(undefined);
  const saveAttempt = useRef<{ body: string; url: string; requestId: string } | null>(null);
  const [profileSearch, setProfileSearch] = useState("");


  const load = async (successNotice = "Private profiles loaded.") => {
    try {
      const next = await systemRequest("GET");
      setState(next);
      setLoadState("ready");
      setNotice(successNotice);
    } catch (error) { setLoadState("error"); setNotice(error instanceof Error ? error.message : "Unable to load private records."); }
  };
  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  const drafts = useMemo(() => state.assignments.filter((assignment) => assignment.status === "DRAFT"), [state]);
  const confirmed = useMemo(() => state.assignments.filter((assignment) => assignment.status === "CONFIRMED"), [state]);

  async function saveProfile(event: FormEvent<HTMLFormElement>, profileId?: string) {
    event.preventDefault();
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const text = (key: string) => String(form.get(key) || "").trim();
      const list = (key: string) => text(key).split("\n").map((item) => item.trim()).filter(Boolean);
      const body = JSON.stringify({ name: text("name"), selfDescribedGender: text("gender"), description: text("description"),
        pronouns: text("pronouns"), species: text("species"), visualDescription: text("visualDescription"), presentation: text("presentation"),
        signatureTraits: list("signatureTraits"), styleTags: list("styleTags"), imageDoNotChange: list("imageDoNotChange"),
        ...(profileId ? { expectedVersion: editingVersion.current } : {}) });
      const url = profileId ? `/api/v1/alters/${profileId}` : "/api/v1/alters";
      if (saveAttempt.current?.body !== body || saveAttempt.current?.url !== url) saveAttempt.current = { body, url, requestId: crypto.randomUUID() };
      const response = await fetch(url, { method: profileId ? "PATCH" : "POST", headers: { ...demoHeaders, "Idempotency-Key": saveAttempt.current.requestId }, body });
      const data = await response.json();
      if (response.status === 409) {
        saveAttempt.current = null;
        throw new Error("This profile changed since you opened it. Your entries are still here. Copy them before reloading to review the latest profile.");
      }
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Unable to save profile.");
      saveAttempt.current = null;
      formElement.reset();
      setSelectedProfileId("");
      await load("Profile saved privately.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save profile."); }
    finally { saveInFlight.current = false; }
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const profilePicture = form.get("setAsProfilePicture") === "true";
      const requestId = crypto.randomUUID();
      if (profilePicture) form.set("requestId", requestId);
      const response = await fetch("/api/system/images", { method: "POST", headers: { "x-system-demo": "local", ...(profilePicture ? { "Idempotency-Key": requestId } : {}) }, body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      formElement.reset();
      await load(profilePicture ? "Profile picture changed. The previous picture remains in private history." : "Image stored in the private gallery.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to upload image."); }
    finally { saveInFlight.current = false; }
  }

  async function chooseProfilePicture(profile: AlterProfile, imageId: string) {
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/alters/${profile.id}/profile-picture`, { method: "PUT", headers: { ...demoHeaders, "Idempotency-Key": requestId }, body: JSON.stringify({ imageId, expectedVersion: profile.version }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Unable to change profile picture.");
      await load("Profile picture changed. The previous picture remains in private history.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to change profile picture."); }
  }

  async function loadAppearance(profile: AlterProfile) {
    if (appearance[profile.id]) return;
    try {
      const response = await fetch(`/api/v1/alters/${profile.id}`, { headers: { "x-system-demo": "local" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Unable to load appearance settings.");
      setAppearance(current => ({ ...current, [profile.id]: data.data }));
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to load appearance settings."); }
  }

  async function saveAppearance(profile: AlterProfile) {
    const current = appearance[profile.id];
    if (!current) return;
    try {
      const requestId = crypto.randomUUID();
      const response = await fetch(`/api/v1/alters/${profile.id}/appearance`, { method: "PUT", headers: { ...demoHeaders, "Idempotency-Key": requestId }, body: JSON.stringify({ appearanceNotes: current.appearanceNotes || null, referenceImageIds: current.appearanceReferenceImageIds, expectedVersion: current.version }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "Unable to save appearance settings.");
      setAppearance(items => ({ ...items, [profile.id]: data.data }));
      await load("Appearance references saved. Profile picture and presence are unchanged.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save appearance settings."); }
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    try {
      await systemRequest("POST", { action: "createDraft", draft: { startsOn: draftStart, endsOn: draftEnd || undefined, manualAlterId: draftProfileId || undefined, sharedContext: sharedContext || undefined } });
      setSharedContext("");
      await load("Coverage draft created. Review it below before confirming.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to create draft."); }
  }

  async function resolveDraft(draftId: string, result: "CONFIRMED" | "REJECTED", alterId?: string) {
    try {
      await systemRequest("POST", { action: "resolveDraft", resolution: { draftId, result, alterId } });
      await load(result === "CONFIRMED" ? "Coverage confirmed and saved to coverage history." : "Coverage draft rejected.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to resolve draft."); }
  }

  const profileForm = (profile?: AlterProfile) => <form key={profile?.id || "new-profile"} onSubmit={(event) => saveProfile(event, profile?.id)} className="form-stack">
    <label>Name<input required name="name" maxLength={120} defaultValue={profile?.name || ""} /></label>
    <label>Self-described gender <span className="optional">optional</span><input name="gender" maxLength={120} defaultValue={profile?.selfDescribedGender || ""} /></label>
    <label>Description <span className="optional">optional</span><textarea name="description" maxLength={1000} rows={3} defaultValue={profile?.description || ""} /></label>
    <fieldset className="form-stack visual-identity"><legend>Visual identity</legend>
      <p>Saved identity for image prompts. Leave unknown details empty.</p>
      <label>Species<input name="species" maxLength={500} defaultValue={profile?.species || ""} /></label>
      <label>Visual description<textarea name="visualDescription" maxLength={1000} rows={3} defaultValue={profile?.visualDescription || ""} /></label>
      <label>Presentation<input name="presentation" maxLength={500} defaultValue={profile?.presentation || ""} /></label>
      <label>Pronouns<input name="pronouns" maxLength={500} defaultValue={profile?.pronouns || ""} /></label>
      <label>Signature traits — one per line<textarea name="signatureTraits" rows={3} defaultValue={profile?.signatureTraits?.join("\n") || ""} /></label>
      <label>Style tags — one per line<textarea name="styleTags" rows={3} defaultValue={profile?.styleTags?.join("\n") || ""} /></label>
      <label>Keep unchanged — one per line<textarea name="imageDoNotChange" rows={3} defaultValue={profile?.imageDoNotChange?.join("\n") || ""} /></label>
    </fieldset>
    <div className="actions"><button className="button" type="submit">{profile ? "Save profile changes" : "Add private profile"}</button>{profile && <button className="button button-secondary" type="button" onClick={() => setSelectedProfileId("")}>Cancel editing</button>}</div>
  </form>;

  return <main className="shell profiles-page">
    <AppNavigation current="PROFILES" />
    <header className="site-header"><div><p className="eyebrow">Bunch · private profiles</p><h1>People</h1></div><Link className="button button-secondary" href="/gallery">View private photo gallery</Link></header>
    <p className="notice" role="status">{notice}</p>
    {loadState === "error" && <div className="actions"><p>Private records are unavailable. Sign in if needed, then try again.</p><button className="button" type="button" onClick={() => void load()}>Retry loading profiles</button></div>}
    {loadState === "ready" && <>
      <section className="panel" aria-labelledby="profiles-heading"><h2 id="profiles-heading">Profile lineup</h2>
        <p>View profile pictures and self-described details. Open a profile’s controls to make changes.</p>
        <label>Search profiles by name, species, or style<input type="search" value={profileSearch} onChange={(event) => setProfileSearch(event.target.value)} /></label>
        {state.profiles.length > 0 && !state.profiles.some((profile) => [profile.name, profile.species, ...(profile.styleTags ?? [])].some((value) => value?.toLowerCase().includes(profileSearch.toLowerCase()))) && <p>No matching profiles.</p>}
        {state.profiles.length === 0 ? <p>No profiles are recorded yet. Add a private profile below.</p> : <ul className="profile-list">{state.profiles.filter((profile) => [profile.name, profile.species, ...(profile.styleTags ?? [])].some((value) => value?.toLowerCase().includes(profileSearch.toLowerCase()))).map((profile) => <li key={profile.id}>
          <article className="profile-entry" aria-labelledby={`profile-name-${profile.id}`}>
            <div className="profile-summary"><h3 id={`profile-name-${profile.id}`}>{profile.name}</h3>{profile.selfDescribedGender && <p>{profile.selfDescribedGender}</p>}<p>{profile.description || "No description added."}</p><p>Species: {profile.species || "Not recorded"}</p><p>Visual description: {profile.visualDescription || "Not recorded"}</p></div>
            {profile.profilePicture ? <Image className="profile-picture" src={privateImageUrl(profile.profilePicture.storageKey)} alt={`Profile picture for ${profile.name}`} width={420} height={420} sizes="(max-width: 800px) 90vw, 420px" unoptimized /> : <p className="empty-picture">No profile picture selected.</p>}
            <details className="profile-disclosure" onToggle={(event) => { if (event.currentTarget.open) void loadAppearance(profile); if (!event.currentTarget.open && selectedProfileId === profile.id) setSelectedProfileId(""); }}>
              <summary>Manage {profile.name}’s profile and pictures</summary>
              {selectedProfileId === profile.id ? profileForm(profile) : <button className="button button-secondary" type="button" onClick={() => { editingVersion.current = profile.version; setSelectedProfileId(profile.id); }}>Edit {profile.name}’s details</button>}
              <form onSubmit={uploadImage} className="upload-form compact-upload"><input type="hidden" name="alterId" value={profile.id} /><input type="hidden" name="expectedVersion" value={profile.version} /><input type="hidden" name="setAsProfilePicture" value="true" /><label>Choose a new profile picture<input required name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><button className="button" type="submit">Change {profile.name}’s profile picture</button></form>
              {profile.images.length > 0 && <section aria-labelledby={`gallery-${profile.id}`}><h4 id={`gallery-${profile.id}`}>Private picture history</h4><p className="small">Earlier pictures stay private and available here.</p><div className="profile-images">
                {profile.images.map((image, index) => <figure className="profile-image-card" key={image.id}><Image className="profile-image" src={privateImageUrl(image.storageKey)} alt={`Private picture ${index + 1} for ${profile.name}`} width={240} height={240} sizes="(max-width: 800px) 70vw, 240px" unoptimized /><figcaption>{image.isProfilePicture ? <span className="selected-state">Selected as profile picture</span> : <button className="button button-secondary" type="button" onClick={() => chooseProfilePicture(profile, image.id)}>Use picture {index + 1} for {profile.name}</button>}</figcaption></figure>)}
              </div></section>}
              <section className="form-stack" aria-labelledby={`appearance-${profile.id}`}><h4 id={`appearance-${profile.id}`}>Transformation appearance</h4><p className="small">Choose visual references for Furry Image Studio. This does not change the profile picture, hosting, or fronting.</p>{appearance[profile.id] && <><label>Appearance notes <span className="optional">optional</span><textarea rows={3} maxLength={5000} value={appearance[profile.id].appearanceNotes || ""} onChange={event => setAppearance(items => ({ ...items, [profile.id]: { ...items[profile.id], appearanceNotes: event.target.value } }))} /></label>{profile.images.map((image, index) => <label key={`reference-${image.id}`}><input type="checkbox" checked={appearance[profile.id].appearanceReferenceImageIds.includes(image.id)} onChange={event => setAppearance(items => ({ ...items, [profile.id]: { ...items[profile.id], appearanceReferenceImageIds: event.target.checked ? [...items[profile.id].appearanceReferenceImageIds, image.id] : items[profile.id].appearanceReferenceImageIds.filter(id => id !== image.id) } }))} /> Use private picture {index + 1} as an appearance reference</label>)}<button className="button button-secondary" type="button" onClick={() => void saveAppearance(profile)}>Save appearance references</button></>}</section>
              <form onSubmit={uploadImage} className="upload-form"><input type="hidden" name="alterId" value={profile.id} /><label>Add an image to {profile.name}’s gallery<input required name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><button className="button button-secondary" type="submit">Store private image</button></form>
            </details>
          </article>
        </li>)}</ul>}
        <details className="profile-disclosure" onToggle={(event) => { if (event.currentTarget.open) setSelectedProfileId(""); }}><summary>Add a private profile</summary>{profileForm()}</details>
      </section>



      <section className="panel" aria-labelledby="coverage-heading"><h2 id="coverage-heading">Coverage records</h2><p>Coverage is recorded separately from current front. A draft becomes coverage history only when you confirm it.</p>
        <details className="profile-disclosure"><summary>Create a coverage draft</summary>
          <p className="small">Include a check-in or shared context only if you want it considered for this suggestion.</p>
          <form onSubmit={createDraft} className="form-stack"><label>Starts on<input type="date" value={draftStart} onChange={(event) => setDraftStart(event.target.value)} required /></label><label>Ends on <span className="optional">optional</span><input type="date" value={draftEnd} min={draftStart} onChange={(event) => setDraftEnd(event.target.value)} /></label><label>Manual check-in <span className="optional">optional</span><select value={draftProfileId} onChange={(event) => setDraftProfileId(event.target.value)}><option value="">No selection</option>{state.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><label>Shared ChatGPT context <span className="optional">optional</span><textarea value={sharedContext} onChange={(event) => setSharedContext(event.target.value)} maxLength={500} rows={3} placeholder="A short note you choose to share for this suggestion only" /></label><button className="button" type="submit">Create coverage draft</button></form>
        </details>
        <div className="records"><h3>Coverage drafts awaiting your decision</h3>{drafts.length === 0 ? <p className="small">No coverage drafts.</p> : drafts.map((draft) => <DraftCard key={draft.id} draft={draft} profiles={state.profiles} onResolve={resolveDraft} />)}
          <details className="profile-disclosure"><summary>Confirmed coverage history ({confirmed.length})</summary>{confirmed.length === 0 ? <p className="small">No confirmed coverage records.</p> : <ul className="history-list">{confirmed.map((record) => <li key={record.id}><strong>{state.profiles.find((profile) => profile.id === record.alterId)?.name || "Recorded alter"}</strong><span>{record.startsOn}{record.endsOn ? ` – ${record.endsOn}` : " onward"}</span></li>)}</ul>}</details>
        </div>
      </section>
    </>}
  </main>;
}

function DraftCard({ draft, profiles, onResolve }: { draft: CoverageAssignment; profiles: AlterProfile[]; onResolve: (id: string, result: "CONFIRMED" | "REJECTED", alterId?: string) => void }) {
  const [alterId, setAlterId] = useState(draft.alterId || "");
  return <article className="draft-card"><p><strong>Draft: {draft.startsOn}{draft.endsOn ? ` – ${draft.endsOn}` : " onward"}</strong></p><h4>Why it was suggested</h4><ul>{draft.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><label>Record this as<select value={alterId} onChange={(event) => setAlterId(event.target.value)}><option value="">Choose before confirming</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><div className="actions"><button className="button" type="button" disabled={!alterId} onClick={() => onResolve(draft.id, "CONFIRMED", alterId || undefined)}>Confirm coverage record</button><button className="button button-secondary" type="button" onClick={() => onResolve(draft.id, "REJECTED")}>Reject draft</button></div></article>;
}
