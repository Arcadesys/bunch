"use client";
import { useEffect, useState } from "react";
import type { ImageAllowance } from "@/domain/native-scene";
export function ImageAllowanceNotice({ value, refreshKey, compact = false, onChange }: { value?: ImageAllowance | null; refreshKey?: string; compact?: boolean; onChange?: (allowance: ImageAllowance | null) => void }) {
  const [loaded, setLoaded] = useState<ImageAllowance | null>(null);
  useEffect(() => {
    if (value) return;
    const load = () => { void fetch("/api/v1/image-allowance").then(r => r.ok ? r.json() : null).then(p => setLoaded(p?.data ?? null)).catch(() => setLoaded(null)); };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [value, refreshKey]);
  const allowance = value ?? loaded;
  useEffect(() => { onChange?.(allowance); }, [allowance, onChange]);
  const spend = allowance ? allowance.spendTodayUsd.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 3 }) : null;
  const mode = allowance?.mode === "PAUSED" ? "Paid images paused" : allowance?.mode === "ECONOMY" ? "Economy mode" : "Standard routing";
  if (compact) return <div className="image-allowance-compact" aria-live="polite">
    <strong>{allowance ? `${allowance.remaining} of ${allowance.limit} image uses remaining` : "Checking image allowance…"}</strong>
    <span>{allowance ? `${mode} · ${spend} today` : ""}</span>
    <details><summary>Allowance details</summary>{allowance && <><p>{mode}. Soft limit {allowance.softLimitUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })}; hard limit {allowance.hardLimitUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })}.</p><p>Resets {new Date(allowance.resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} (your local time).</p></>}<p>Finishing uses 1 image use. Generations, repairs and photo finishing share this allowance. Attempts count once sent to the image provider, including failed attempts.</p></details>
  </div>;
  return <div className={`image-spend-state ${allowance?.mode.toLowerCase() ?? "checking"}`} aria-live="polite"><p><strong>{allowance ? `${allowance.remaining} of ${allowance.limit} image uses remaining` : "Image allowance is checked when you submit."}</strong></p>{allowance && <><p><strong>{mode}</strong> · {spend} today. Soft limit {allowance.softLimitUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })}; hard limit {allowance.hardLimitUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })}.</p><p>Prompt-only: {allowance.nextPlannedRoutes.promptOnly.model}, {allowance.nextPlannedRoutes.promptOnly.quality}. Identity-sensitive: {allowance.nextPlannedRoutes.identitySensitive.model}, {allowance.nextPlannedRoutes.identitySensitive.quality}.</p><p>Resets {new Date(allowance.resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} (your local time).</p></>}<p>Uses 1 image use. Generations, repairs and photo finishing share this allowance. Attempts count once sent to the image provider, including failed attempts.</p></div>;
}
