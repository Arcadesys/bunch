"use client";

import { useEffect, useState, type FormEvent } from "react";

type Invitation = {
  id: string;
  status: "AVAILABLE" | "USED" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  createdAt: string;
};

export function TenantInvitationControls() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [activation, setActivation] = useState<{ open: boolean; maxFriends: number; reason?: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/v1/account/invitations", { cache: "no-store" });
    if (!response.ok) throw new Error("Invitations are unavailable. Please try again.");
    const body = await response.json();
    setInvitations(body.data);
    setActivation(body.activation);
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Invitations are unavailable. Please try again."));
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function create() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/v1/account/invitations", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Invitation could not be created.");
      const link = `${location.origin}/join#invite=${body.data.token}`;
      await navigator.clipboard.writeText(link);
      setMessage("Invitation link copied. It works once, expires in seven days, and is not redeemed by opening it.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invitation could not be created.");
    } finally { setBusy(false); }
  }
  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/account/invitations/activate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkedAt: new Date(String(form.get("checkedAt"))).toISOString(),
          slots: Number(form.get("slots")),
          capacityConfirmed: form.get("capacityConfirmed") === "on",
          recoveryConfirmed: form.get("recoveryConfirmed") === "on",
          capacityEvidence: form.get("capacityEvidence"),
          recoveryEvidence: form.get("recoveryEvidence"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Invitations could not be opened.");
      setMessage("Invitations are open for the recorded capacity. You can now create a one-use link.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invitations could not be opened.");
    } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/v1/account/invitations/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "Invitation could not be revoked.");
      }
      setMessage("Invitation revoked.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invitation could not be revoked.");
    } finally { setBusy(false); }
  }
  return <section className="tenant-invitation-controls" aria-labelledby="tenant-invitations-heading">
    <h2 id="tenant-invitations-heading">Invite a new private system</h2>
    <p>Create a one-use link for someone to make their own isolated Bunch account. Opening a link does not use it.</p>
    {message && <p className="pilot-notice" role="status">{message}</p>}
    {activation && !activation.open ? <form onSubmit={activate} className="tenant-activation-form">
      <h3>Open invitations</h3>
      <p>{activation.reason}</p>
      <label>When did you verify this?<input name="checkedAt" type="datetime-local" required /></label>
      <label>Capacity evidence<textarea name="capacityEvidence" required minLength={12} maxLength={2000} placeholder="What capacity and cost check did you complete?" /></label>
      <label>Recovery evidence<textarea name="recoveryEvidence" required minLength={12} maxLength={2000} placeholder="What seven-day recovery and restore check did you complete?" /></label>
      <label>Initial private systems<select name="slots" defaultValue="3"><option value="3">3 systems</option><option value="4">4 systems</option></select></label>
      <label className="pilot-check"><input type="checkbox" name="capacityConfirmed" required />I verified capacity for the selected number of systems.</label>
      <label className="pilot-check"><input type="checkbox" name="recoveryConfirmed" required />I verified encrypted recovery and a restore test in the last seven days.</label>
      <button disabled={busy}>Record evidence and open invitations</button>
    </form> : <button type="button" onClick={() => void create()} disabled={busy || !activation}>Create and copy invitation link</button>}
    <h3>Invitation status</h3>
    {invitations.length === 0 ? <p>No invitation links created yet.</p> : <ul className="tenant-invitation-list">
      {invitations.map((invitation) => <li key={invitation.id}>
        <p><strong>{invitation.status}</strong><br />Expires {new Date(invitation.expiresAt).toLocaleString()}.</p>
        {invitation.status === "AVAILABLE" && <button type="button" onClick={() => void revoke(invitation.id)} disabled={busy}>Revoke invitation</button>}
      </li>)}
    </ul>}
  </section>;
}
