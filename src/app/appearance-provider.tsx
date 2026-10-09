"use client";

import { createContext, useEffect } from "react";
import { appearanceInputSchema, defaultAppearance, resolvePalette, type AppearanceDocument, type AppearanceInput } from "@/domain/appearance";

export const APPEARANCE_CACHE_KEY = "bunch-appearance-v1";
export const DEMO_APPEARANCE_CACHE_KEY = "bunch-demo-appearance-v1";
export const APPEARANCE_PREVIEW_EVENT = "bunch:appearance-preview";
export const AppearanceContext = createContext<AppearanceDocument | null>(null);

export function applyAppearance(input: AppearanceInput) {
  const palette = resolvePalette(input);
  const root = document.documentElement;
  root.dataset.appearance = input.mode === "custom" ? "custom" : input.preset;
  root.dataset.glow = input.glow ? "on" : "off";
  root.dataset.reducedDecoration = input.reducedDecoration ? "on" : "off";
  const values: Record<string, string> = {
    "--paper": palette.background, "--surface": palette.surface, "--ink": palette.text,
    "--muted": palette.mutedText, "--accent": palette.primary, "--focus": palette.secondary,
    "--bunch-pink": palette.secondary, "--bunch-orange": palette.primary,
  };
  for (const [name, value] of Object.entries(values)) root.style.setProperty(name, value);
}

export function cachedAppearance(key = APPEARANCE_CACHE_KEY): AppearanceDocument | null {
  try {
    const parsed = appearanceInputSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
    return parsed.success ? { ...parsed.data, updatedAt: null } : null;
  } catch { return null; }
}

export function AppearanceProvider({ children, initialAppearance = null }: { children: React.ReactNode; initialAppearance?: AppearanceDocument | null }) {
  useEffect(() => {
    const demo = location.pathname.startsWith("/demo");
    const cached = cachedAppearance(demo ? DEMO_APPEARANCE_CACHE_KEY : APPEARANCE_CACHE_KEY);
    applyAppearance(demo ? (cached ?? defaultAppearance) : (initialAppearance ?? cached ?? defaultAppearance));
    const preview = (event: Event) => applyAppearance((event as CustomEvent<AppearanceInput>).detail);
    window.addEventListener(APPEARANCE_PREVIEW_EVENT, preview);
    let active = true;
    if (!demo && location.pathname !== "/") {
      void fetch("/api/v1/preferences/appearance", { cache: "no-store" }).then(async response => {
        if (!response.ok) throw new Error("read failed");
        const payload = await response.json() as { data: AppearanceDocument };
        if (!active) return;
        applyAppearance(payload.data);
        localStorage.setItem(APPEARANCE_CACHE_KEY, JSON.stringify(payload.data));
      }).catch(() => { /* The cached palette remains active. */ });
    }
    return () => { active = false; window.removeEventListener(APPEARANCE_PREVIEW_EVENT, preview); };
  }, [initialAppearance]);
  return <AppearanceContext.Provider value={initialAppearance}>{children}</AppearanceContext.Provider>;
}
