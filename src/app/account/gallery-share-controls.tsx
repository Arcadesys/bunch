"use client";

import { useEffect, useRef, useState } from "react";

type Share = { id: string; expiresAt: string | null; createdAt?: string; revokedAt?: string | null; token?: string; url?: string };
const durations = [
  ["1h", "1 hour"], ["2h", "2 hours"], ["4h", "4 hours"], ["1d", "1 day"], ["1w", "1 week"], ["forever", "Forever"],
] as const;

function newKey() { return crypto.randomUUID(); }
function displayExpiry(expiresAt: string | null) { return expiresAt ? `Expires ${new Date(expiresAt).toLocaleString()}` : "Does not expire"; }
function shareUrl(share: Share) { return share.url ?? (share.token ? `${location.origin}/gallery/share/${encodeURIComponent(share.token)}` : ""); }


function ShareRow({ share, busy, onRevoke, onMessage }: { share: Share; busy: boolean; onRevoke: () => void; onMessage: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const url = shareUrl(share);
  const [openedAt] = useState(() => Date.now());
  const inactive = Boolean(share.revokedAt || share.expiresAt && new Date(share.expiresAt).getTime() <= openedAt);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onMessage("Gallery link copied.");
    } catch {
      input.current?.focus();
      input.current?.select();
      onMessage("Could not copy automatically. The link is selected below; use your browser’s Copy command or Ctrl+C / Command+C.");
    }
  }
  return <li><div>
    {share.createdAt && <p>Created {new Date(share.createdAt).toLocaleString()}</p>}
    <p>{share.revokedAt ? "Revoked" : displayExpiry(share.expiresAt)}</p>
    {url && !inactive ? <>
      <label>Gallery link<input ref={input} readOnly value={url} onFocus={event => event.currentTarget.select()} /></label>
      <button type="button" className="button" onClick={() => void copy()}>Copy link</button>
      <a href={url}>Open gallery</a>
    </> : !inactive ? <p>For privacy, the full link is shown only when created. It cannot be recovered after reloading. Create a new link above if you need another copy; revoke this one if it is no longer needed.</p> : null}
  </div><button className="button button-secondary" type="button" disabled={busy || inactive} onClick={onRevoke}>Revoke link</button></li>;
}

export function GalleryShareControls() {
  const [shares, setShares] = useState<Share[]>([]);
  const [duration, setDuration] = useState<(typeof durations)[number][0]>("1h");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  const loading = useRef(false);
  async function refresh() {
    if (loading.current) return;
    loading.current = true;
    try {
      const response = await fetch("/api/v1/account/gallery-shares", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as { data: Share[] };
      setShares(result.data);
      setLoaded(true);
    } catch { setMessage("Gallery share controls are unavailable. Please try again."); }
    finally { loading.current = false; }
  }
  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, []);
  async function create() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/account/gallery-shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duration }) });
      const result = await response.json() as { data?: Share };
      if (!response.ok || !result.data) throw new Error();
      setShares((current) => [result.data!, ...current]);
      setMessage("New read-only gallery link created.");
    } catch { setLoaded(false); setMessage("Link creation could not be confirmed. Reload gallery links to check before creating another. A link whose full URL was not received can be revoked and replaced."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function revoke(id: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/account/gallery-shares/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "Idempotency-Key": newKey() } });
      if (!response.ok) throw new Error();
      setShares((current) => current.filter((share) => share.id !== id));
      setMessage("Gallery link revoked.");
    } catch { setMessage("The gallery link could not be revoked. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="gallery-share-controls" aria-labelledby="gallery-share-heading">
    <h2 id="gallery-share-heading">Share a read-only photo gallery</h2>
    <p>Anyone with the link can view your whole system’s profile names and all gallery photos, including photos added later and retained archived profiles. This does not share notes, todos, or hosting/fronting records. Forwarding, downloads, and screenshots cannot be revoked.</p>
    <label>Link lifetime<select value={duration} onChange={(event) => setDuration(event.target.value as typeof duration)}>{durations.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <button className="button" type="button" disabled={busy || !loaded} onClick={() => void create()}>Create gallery link</button>
    {!loaded && <button type="button" onClick={() => void refresh()}>Retry loading gallery links</button>}
    {message && <p role="status" aria-live="polite" className="pilot-notice">{message}</p>}
    <p>Copy a new link before leaving or reloading this page.</p>
    <h3>Existing gallery links</h3>
    {shares.length ? <ul className="gallery-share-list">{shares.map(share => <ShareRow key={share.id} share={share} busy={busy} onMessage={setMessage} onRevoke={() => void revoke(share.id)} />)}</ul> : loaded ? <p>No gallery links.</p> : <p>Loading gallery links…</p>}

  </section>;
}
