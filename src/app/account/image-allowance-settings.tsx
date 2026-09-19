"use client";
import { useEffect, useState } from "react";
type Account = { id: string; name: string; role: string; state: string; override: number | null };
export function ImageAllowanceSettings() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { void fetch("/api/v1/account/image-allowances").then(r => r.ok ? r.json() : null).then(p => setAccounts(p?.data ?? [])).catch(() => {}); }, []);
  if (!accounts.length) return null;
  return <section className="panel" aria-labelledby="image-settings"><h2 id="image-settings">Pilot image allowances</h2><p>Each pilot account gets 10 image uses daily. Leave blank to use the default; enter 0 to disable new requests. Changes take effect immediately.</p><p role="status">{notice}</p>{accounts.map((account, index) => <form key={account.id} className="upload-form" onSubmit={async event => {
    event.preventDefault();
    const field = new FormData(event.currentTarget).get("limit") as string;
    setSaving(true);
    try {
      const r = await fetch("/api/v1/account/image-allowances", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerId: account.id, limit: field.trim() === "" ? null : Number(field) }) });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error?.message ?? "Could not save allowance.");
      setNotice(`Allowance saved for ${account.name}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save allowance."); }
    finally { setSaving(false); }
  }}><label htmlFor={`allowance-${index}`}>{account.name} · {account.role.toLowerCase()} · {account.state.toLowerCase()}<input id={`allowance-${index}`} name="limit" type="number" min="0" max="1000" step="1" defaultValue={account.override ?? ""} /></label><button className="button" disabled={saving}>Save allowance for {account.name}</button></form>)}</section>;
}
