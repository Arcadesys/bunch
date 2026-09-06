"use client";

import { useEffect, useState } from "react";

type Share = { id: string; expiresAt: string | null; token?: string; url?: string };
const durations = [
  ["1h", "1 hour"], ["2h", "2 hours"], ["4h", "4 hours"], ["1d", "1 day"], ["1w", "1 week"], ["forever", "Forever"],
] as const;

function newKey() { return crypto.randomUUID(); }
function displayExpiry(expiresAt: string | null) { return expiresAt ? `Expires ${new Date(expiresAt).toLocaleString()}` : "Does not expire"; }
function shareUrl(share: Share) { return share.url ?? (share.token ? `${location.origin}/gallery/share/${encodeURIComponent(share.token)}` : ""); }

export function GalleryShareControls() {
  const [shares, setShares] = useState<Share[]>([]);
  const [duration, setDuration] = useState<(typeof durations)[number][0]>("1h");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    try {
      const response = await fetch("/api/v1/account/gallery-shares", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as { data: Share[] };
      setShares(result.data);
    } catch { setMessage("Gallery share controls are unavailable. Please try again."); }
  }
  useEffect(() => {
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, []);
  async function create() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/account/gallery-shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duration }) });
      const result = await response.json() as { data?: Share };
      if (!response.ok || !result.data) throw new Error();
      setShares((current) => [result.data!, ...current]);
      setMessage("New read-only gallery link created.");
    } catch { setMessage("The gallery link could not be created. Please try again."); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/account/gallery-shares/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "Idempotency-Key": newKey() } });
      if (!response.ok) throw new Error();
      setShares((current) => current.filter((share) => share.id !== id));
      setMessage("Gallery link revoked.");
    } catch { setMessage("The gallery link could not be revoked. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="gallery-share-controls" aria-labelledby="gallery-share-heading">
    <h2 id="gallery-share-heading">Share a read-only photo gallery</h2>
    <p>Anyone with the link can view the photos you choose to share. Forwarding, downloads, and screenshots cannot be revoked.</p>
    <label>Link lifetime<select value={duration} onChange={(event) => setDuration(event.target.value as typeof duration)}>{durations.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <button className="button" type="button" disabled={busy} onClick={() => void create()}>Create gallery link</button>
    {message && <p aria-live="polite" className="pilot-notice">{message}</p>}
    <h3>Existing gallery links</h3>
    {shares.length ? <ul className="gallery-share-list">{shares.map((share) => <li key={share.id}><div>{shareUrl(share) ? <a href={shareUrl(share)}>{shareUrl(share)}</a> : <span>Link available after refresh</span>}<p>{displayExpiry(share.expiresAt)}</p></div><button className="button button-secondary" type="button" disabled={busy} onClick={() => void revoke(share.id)}>Revoke link</button></li>)}</ul> : <p>No active gallery links.</p>}
  </section>;
}
