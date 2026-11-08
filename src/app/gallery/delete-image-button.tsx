"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Two-step permanent delete. The first press only asks; focus lands on "Keep it" so a
 * stray Enter never deletes. Without onDeleted, the page is refreshed from the server.
 */
export function DeleteImageButton({ url, label, onDeleted }: { url: string; label: string; onDeleted?: () => void }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "The image could not be deleted. Try again.");
      }
      if (onDeleted) onDeleted();
      else router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The image could not be deleted. Try again.");
      setBusy(false);
    }
  }

  if (!confirming) {
    return <button type="button" className="button button-secondary" aria-label={`Delete ${label}`} onClick={() => setConfirming(true)}>Delete</button>;
  }
  return <div className="delete-image-confirm" role="group" aria-label={`Confirm deleting ${label}`}>
    <p><strong>Delete this image permanently?</strong> Repairs made from it are deleted too. This cannot be undone.</p>
    <div className="actions">
      <button type="button" className="button" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Yes, delete permanently"}</button>
      <button type="button" className="button button-secondary" disabled={busy} autoFocus onClick={() => { setConfirming(false); setError(null); }}>Keep it</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
