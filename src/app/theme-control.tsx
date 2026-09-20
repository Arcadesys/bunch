"use client";

import { useContext, useEffect, useState } from "react";
import {
  appearanceContrastChecks, appearancePresets, defaultAppearance, resolvePalette,
  type AppearanceDocument, type AppearanceInput, type AppearancePalette, type AppearancePresetId,
} from "@/domain/appearance";
import { APPEARANCE_CACHE_KEY, APPEARANCE_PREVIEW_EVENT, DEMO_APPEARANCE_CACHE_KEY, AppearanceContext, applyAppearance, cachedAppearance } from "./appearance-provider";

const fields: { key: keyof AppearancePalette; label: string }[] = [
  { key: "background", label: "Background" }, { key: "surface", label: "Surface" },
  { key: "text", label: "Primary text" }, { key: "mutedText", label: "Muted text" },
  { key: "primary", label: "Primary accent" }, { key: "secondary", label: "Secondary accent" },
];

function announcePreview(value: AppearanceInput) {
  applyAppearance(value);
  window.dispatchEvent(new CustomEvent(APPEARANCE_PREVIEW_EVENT, { detail: value }));
}

export function ThemeControl({ demo = false }: { demo?: boolean }) {
  const accountInitial = useContext(AppearanceContext);
  const initial = demo ? defaultAppearance : (accountInitial ?? defaultAppearance);
  const [draft, setDraft] = useState<AppearanceDocument>(initial);
  const [saved, setSaved] = useState<AppearanceDocument>(initial);
  const [notice, setNotice] = useState("Reading your saved appearance…");
  const [busy, setBusy] = useState(false);
  const [highContrast, setHighContrast] = useState(false);

  useEffect(() => {
    const local = cachedAppearance(demo ? DEMO_APPEARANCE_CACHE_KEY : APPEARANCE_CACHE_KEY);
    const frame = requestAnimationFrame(() => {
      if (local && (demo || !accountInitial)) { setDraft(local); setSaved(local); announcePreview(local); setNotice(demo ? "Using this browser’s demo appearance." : "Using a locally cached appearance while account settings load."); }
      else if (demo) setNotice("Demo appearance is saved in this browser only.");
      setHighContrast(localStorage.getItem("bunch-high-contrast") === "true");
    });
    if (demo) return () => cancelAnimationFrame(frame);
    void fetch("/api/v1/preferences/appearance", { cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("Account appearance could not be read.");
      const payload = await response.json() as { data: AppearanceDocument };
      setDraft(payload.data); setSaved(payload.data); announcePreview(payload.data);
      localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(payload.data));
      setNotice("Appearance is synced to this Bunch account.");
    }).catch(() => setNotice(local ? "Account appearance could not be read. Showing the locally cached scheme." : "Account appearance could not be read. Showing Bunch defaults."));
    return () => cancelAnimationFrame(frame);
  }, [accountInitial, demo]);

  const palette = resolvePalette(draft);
  const invalidFields = fields.filter(field => !/^#[0-9a-f]{6}$/i.test(palette[field.key]));
  const failures = appearanceContrastChecks(palette).filter(check => check.ratio < check.minimum);
  const update = (next: AppearanceDocument) => { setDraft(next); announcePreview(next); };
  const choosePreset = (preset: AppearancePresetId) => update({ ...draft, mode: "preset", preset, palette: appearancePresets[preset].palette });
  const setColor = (key: keyof AppearancePalette, value: string) => {
    if (!/^#[0-9a-f]{6}$/i.test(value)) { setDraft(current => ({ ...current, mode: "custom", palette: { ...current.palette, [key]: value } })); return; }
    update({ ...draft, mode: "custom", palette: { ...palette, [key]: value.toLowerCase() } });
  };

  async function save() {
    if (failures.length || invalidFields.length) return;
    setBusy(true); setNotice("Saving appearance…");
    try {
      if (demo) {
        localStorage.setItem(DEMO_APPEARANCE_CACHE_KEY, JSON.stringify(draft));
        setSaved(draft); setNotice("Demo appearance saved in this browser only."); return;
      }
      const response = await fetch("/api/v1/preferences/appearance", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "Appearance could not be saved.");
      setDraft(payload.data); setSaved(payload.data); announcePreview(payload.data);
      localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(payload.data));
      setNotice("Appearance saved to this Bunch account.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Appearance could not be saved."); }
    finally { setBusy(false); }
  }

  function resetDefaults() { update(defaultAppearance); setNotice("Bunch defaults are previewing. Save to keep them."); }
  function toggleHighContrast(value: boolean) {
    setHighContrast(value); document.documentElement.dataset.highContrast = value ? "on" : "off";
    localStorage.setItem("bunch-high-contrast", String(value));
  }

  return <section className="appearance-studio" aria-labelledby="appearance-heading">
    <div className="appearance-heading"><div><h2 id="appearance-heading">Appearance</h2><p>Pick a starting point, then make Bunch yours. Themes belong to this account, not to any one person.</p></div>
      <button type="button" className="safe-reset" onClick={resetDefaults}>Reset to Bunch defaults</button></div>
    <fieldset className="preset-picker"><legend>Color scheme</legend>{Object.entries(appearancePresets).map(([id, preset]) => <button type="button" key={id}
      aria-pressed={draft.mode === "preset" && draft.preset === id} onClick={() => choosePreset(id as AppearancePresetId)}>
      <span className="preset-swatches" aria-hidden="true"><i style={{ background: preset.palette.background }} /><i style={{ background: preset.palette.primary }} /><i style={{ background: preset.palette.secondary }} /></span>{preset.label}</button>)}</fieldset>
    <details className="custom-palette" open={draft.mode === "custom"}><summary>Customize this palette</summary><div className="color-fields">{fields.map(field => <label key={field.key}><span>{field.label}</span><span className="color-field"><input type="color" value={/^#[0-9a-f]{6}$/i.test(palette[field.key]) ? palette[field.key] : "#000000"} onChange={event => setColor(field.key, event.target.value)} /><input aria-label={`${field.label} hex value`} value={palette[field.key]} pattern="#[0-9A-Fa-f]{6}" onChange={event => setColor(field.key, event.target.value)} /></span></label>)}</div></details>
    <div className="appearance-toggles"><label><input type="checkbox" checked={draft.glow} onChange={event => update({ ...draft, glow: event.target.checked })} /> Glow</label><label><input type="checkbox" checked={draft.reducedDecoration} onChange={event => update({ ...draft, reducedDecoration: event.target.checked })} /> Reduce decoration</label><label><input type="checkbox" checked={highContrast} onChange={event => toggleHighContrast(event.target.checked)} /> High contrast on this device</label></div>
    <section className="appearance-preview" aria-label="Theme preview"><p className="command-kicker">Live preview</p><h3>What would help right now?</h3><p className="preview-muted">Choose one place to begin.</p><a href="#appearance-heading" onClick={event => event.preventDefault()}>Resume my day</a><button type="button">Open todo</button><button type="button" disabled>Unavailable action</button></section>
    {invalidFields.length || failures.length ? <div className="contrast-failures" role="alert"><h3>Adjust these colors before saving</h3><ul>{invalidFields.map(field => <li key={field.key}>{field.label}: enter a six-digit hexadecimal color such as #55d8ff.</li>)}{failures.map(failure => <li key={failure.label}>{failure.label}: {failure.ratio.toFixed(2)}:1; needs {failure.minimum}:1.</li>)}</ul></div> : <p className="contrast-pass">Contrast checks pass for text, controls, and focus accents.</p>}
    <div className="appearance-actions"><button type="button" disabled={busy || invalidFields.length > 0 || failures.length > 0} onClick={() => void save()}>Save theme</button><button type="button" className="button-secondary" disabled={busy} onClick={() => update(saved)}>Discard preview</button></div>
    <p role="status">{notice}</p>
  </section>;
}
