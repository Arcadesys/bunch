"use client";

import { FormEvent, useEffect, useState } from "react";

type Profile = { id: string; name: string; archivedAt?: string | null };
type Credential = { id: string; label: string; selectedAlterIds: string[]; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? body.error ?? "Request failed.");
  return body;
}

export default function ReferenceCredentialsPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [label, setLabel] = useState("Working Monkey laptop");
  const [notice, setNotice] = useState("Loading reference access…");
  const [secret, setSecret] = useState<string | null>(null);

  const load = async () => {
    try {
      const [alterResult, credentialResult] = await Promise.all([request("/api/v1/alters?limit=100"), request("/api/account/reference-credentials")]);
      setProfiles(alterResult.data.filter((profile: Profile) => !profile.archivedAt));
      setCredentials(credentialResult.data);
      setNotice("Reference credentials are separate from companion access.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not load reference access."); }
  };
  useEffect(() => { void load(); }, []);

  async function issue(event: FormEvent) {
    event.preventDefault(); setSecret(null);
    try {
      const result = await request("/api/account/reference-credentials", { method: "POST", body: JSON.stringify({ label, selectedAlterIds: selected }) });
      setSecret(result.data.secret); setNotice("Copy the credential now. Bunch stores only a hash and cannot show it again."); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not create credential."); }
  }
  async function revoke(id: string) {
    try { await request(`/api/account/reference-credentials/${id}`, { method: "DELETE" }); setNotice("Credential revoked. It can no longer fetch references."); await load(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not revoke credential."); }
  }
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <main className="system-page reference-account">
    <a href="/">← Back to Bunch</a>
    <h1>Reference access</h1>
    <p className="notice" role="status">{notice}</p>
    <section className="panel"><h2>Create laptop reference credential</h2>
      <p>It can read only the selected profiles and their chosen reference images. It cannot read notes, tasks, preferences, presence, history, or work context.</p>
      <form onSubmit={issue}><label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} required /></label>
        <fieldset><legend>Profiles this credential may read</legend>{profiles.map((profile) => <label key={profile.id} className="check-row"><input type="checkbox" checked={selected.includes(profile.id)} onChange={() => toggle(profile.id)} /> {profile.name}</label>)}</fieldset>
        <button type="submit" disabled={!selected.length}>Create one-time credential</button>
      </form>
      {secret && <div className="secret-receipt"><h3>Copy now</h3><code>{secret}</code><p>This value will not be shown again.</p></div>}
    </section>
    <section className="panel"><h2>Existing credentials</h2>{credentials.length ? <ul className="credential-list">{credentials.map((credential) => <li key={credential.id}><strong>{credential.label}</strong><span>{credential.revokedAt ? "Revoked" : "Active"} · {credential.selectedAlterIds.length} selected profile{credential.selectedAlterIds.length === 1 ? "" : "s"}</span><span>Created {new Date(credential.createdAt).toLocaleString()}</span>{credential.lastUsedAt && <span>Last used {new Date(credential.lastUsedAt).toLocaleString()}</span>}{!credential.revokedAt && <button type="button" onClick={() => void revoke(credential.id)}>Revoke</button>}</li>)}</ul> : <p>No reference credentials yet.</p>}</section>
  </main>;
}
