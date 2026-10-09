import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { InstallProvider } from "./install-provider";
import { AppearanceProvider } from "./appearance-provider";
import { appearanceInputSchema, resolvePalette, type AppearanceDocument } from "@/domain/appearance";
import { requireOwnerId } from "@/server/auth";
import { repository } from "@/server/repository";
import "./styles.css";

const themeScript = `(() => {
  try {
    const demo = window.location.pathname.startsWith("/demo");
    const accountLoaded = document.documentElement.dataset.accountAppearance === "true";
    const saved = JSON.parse(window.localStorage.getItem(demo ? "bunch-demo-appearance-v1" : "bunch-appearance-v1") || "null");
    const palette = saved && saved.palette;
    if (palette && (demo || !accountLoaded)) {
      const root = document.documentElement;
      const values = {"--paper":palette.background,"--surface":palette.surface,"--ink":palette.text,"--muted":palette.mutedText,"--accent":palette.primary,"--focus":palette.secondary,"--bunch-pink":palette.secondary,"--bunch-orange":palette.primary};
      Object.entries(values).forEach(([name,value]) => typeof value === "string" && root.style.setProperty(name,value));
      root.dataset.glow = saved.glow ? "on" : "off";
      root.dataset.reducedDecoration = saved.reducedDecoration ? "on" : "off";
    }
    document.documentElement.dataset.highContrast = window.localStorage.getItem("bunch-high-contrast") === "true" ? "on" : "off";
  } catch {
    document.documentElement.dataset.highContrast = "off";
  }
})();`;

export const metadata: Metadata = {
  title: "Bunch — your private companion",
  description: "A private, user-confirmed catch-up for notes, todos, decisions, threads, and switch history.",
  icons: { icon: "/bunch-barrel-monkeys.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Bunch", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#19121f" };
export const dynamic = "force-dynamic";

async function accountAppearance(): Promise<AppearanceDocument | null> {
  try {
    const owner = await requireOwnerId();
    const saved = (await repository.listPreferences(owner)).find(preference => preference.key === "appearance.v1");
    if (!saved) return null;
    const parsed = appearanceInputSchema.safeParse(JSON.parse(saved.value));
    return parsed.success ? { ...parsed.data, updatedAt: saved.updatedAt } : null;
  } catch { return null; }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const initialAppearance = await accountAppearance();
  const palette = initialAppearance ? resolvePalette(initialAppearance) : null;
  const style = palette ? {
    "--paper": palette.background, "--surface": palette.surface, "--ink": palette.text,
    "--muted": palette.mutedText, "--accent": palette.primary, "--focus": palette.secondary,
    "--bunch-pink": palette.secondary, "--bunch-orange": palette.primary,
  } as CSSProperties : undefined;
  return (
    <html lang="en" data-theme="dark" data-account-appearance={initialAppearance ? "true" : "false"}
      data-appearance={initialAppearance?.mode === "custom" ? "custom" : initialAppearance?.preset}
      data-glow={initialAppearance?.glow ? "on" : "off"} data-reduced-decoration={initialAppearance?.reducedDecoration ? "on" : "off"}
      style={style} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body><AppearanceProvider initialAppearance={initialAppearance}><InstallProvider>{children}</InstallProvider></AppearanceProvider></body>
    </html>
  );
}
