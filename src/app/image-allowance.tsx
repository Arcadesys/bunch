"use client";
import { useEffect, useState } from "react";
import type { ImageAllowance } from "@/domain/native-scene";
export function ImageAllowanceNotice({ value, refreshKey, compact = false }: { value?: ImageAllowance | null; refreshKey?: string; compact?: boolean }) {
  const [loaded, setLoaded] = useState<ImageAllowance | null>(null);
  useEffect(() => {
    if (value) return;
    const load = () => { void fetch("/api/v1/image-allowance").then(r => r.ok ? r.json() : null).then(p => setLoaded(p?.data ?? null)).catch(() => setLoaded(null)); };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, [value, refreshKey]);
  const allowance = value ?? loaded;
  if (compact) return <div className="image-allowance-compact" aria-live="polite">
    <strong>{allowance ? `${allowance.remaining} of ${allowance.limit} image uses remaining` : "Checking image allowance…"}</strong>
    <details><summary>Allowance details</summary>{allowance && <p>Resets {new Date(allowance.resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} (your local time).</p>}<p>Finishing uses 1 image use. Generations, repairs and photo finishing share this allowance. Attempts count once sent to the image provider, including failed attempts.</p></details>
  </div>;
  return <div aria-live="polite"><p><strong>{allowance ? `${allowance.remaining} of ${allowance.limit} image uses remaining` : "Image allowance is checked when you submit."}</strong></p>{allowance && <p>Resets {new Date(allowance.resetsAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} (your local time).</p>}<p>Uses 1 image use. Generations, repairs and photo finishing share this allowance. Attempts count once sent to the image provider, including failed attempts.</p></div>;
}
