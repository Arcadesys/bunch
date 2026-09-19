"use client";
import { useEffect, useRef, useState } from "react";
import type { RepairSource, ImageAllowance } from "@/domain/native-scene";
type Choice = RepairSource & { label: string; url: string };
export function RepairForm({ selected, onSelect, onSaved, blocked }: { selected: RepairSource | null; onSelect: (source: RepairSource | null) => void; onSaved: () => Promise<void>; blocked: boolean }) {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [open, setOpen] = useState(false);
  const [correction, setCorrection] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowance, setAllowance] = useState<ImageAllowance | null>(null);
  const ids = useRef(new Map<string, string>());
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (selected) field.current?.focus(); }, [selected]);
  useEffect(() => {
    if (!open && !selected) return;
    let cancelled = false;
    void fetch("/api/v1/image-repair-sources").then(async r => { const p = await r.json(); if (!r.ok) throw new Error(p.error?.message ?? "Could not load repair sources."); if (!cancelled) setChoices(p.data); }).catch(e => { if (!cancelled) setNotice(e.message); });
    return () => { cancelled = true; };
  }, [open, selected]);
  const source = choices.find(c => c.kind === selected?.kind && c.id === selected.id);
  return <section className="panel" aria-labelledby="repair-heading"><h2 id="repair-heading">Repair a private image</h2><p>Choose a generated image or private gallery image, then describe the correction. The original stays saved.</p>{!open && !selected ? <button className="button" onClick={() => setOpen(true)}>Choose an image to repair</button> : <form className="upload-form" onSubmit={async event => {
    event.preventDefault();
    if (!selected || !correction.trim()) return;
    setBusy(true);
    const fingerprint = JSON.stringify([selected, correction.trim()]);
    const requestId = ids.current.get(fingerprint) ?? crypto.randomUUID();
    ids.current.set(fingerprint, requestId);
    try {
      const response = await fetch("/api/v1/native-scenes/renders", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestId }, body: JSON.stringify({ scene: correction.trim(), repairSource: selected }) });
      const p = await response.json();
      if (p.meta?.allowance) setAllowance(p.meta.allowance);
      if (!response.ok) throw new Error(p.error?.message ?? "Could not start repair.");
      ids.current.delete(fingerprint);
      setNotice("Repair started. Your original is preserved; the new image will appear in history.");
      await onSaved();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not start repair."); }
    finally { setBusy(false); }
  }}><label>Image to repair<select required value={selected ? `${selected.kind}:${selected.id}` : ""} onChange={event => { const item = choices.find(c => `${c.kind}:${c.id}` === event.target.value); onSelect(item ? { kind: item.kind, id: item.id } : null); }}><option value="">Choose a private image</option>{choices.map((c, i) => <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>{i + 1}. {c.label}</option>)}</select></label>{source && <img src={source.url} alt="Original image selected for repair" style={{ maxWidth: "100%", height: "auto" }} />}<label>Describe the correction<textarea ref={field} required minLength={1} maxLength={5000} rows={4} value={correction} onChange={event => setCorrection(event.target.value)} /></label><p>Uses 1 image use. The repaired image retains the original orientation.</p>{allowance && <p>{allowance.remaining} of {allowance.limit} image uses remaining.</p>}<button className="button" disabled={busy || blocked || !source}>{busy ? "Starting repair…" : "Repair and save new image"}</button></form>}<p role="status">{notice}</p></section>;
}
