"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type AppPage = "CATCH_UP" | "BOARD" | "NOTES" | "THREADS" | "HISTORY" | "PROFILES" | "GALLERY" | "GROUP_PHOTO" | "OPTIONS";
type IconName = "home" | "todos" | "notes" | "people" | "history" | "options" | "switch" | "review" | "update" | "glow" | "contrast";
const destinations: { href: string; label: string; page: AppPage; icon: IconName }[] = [
  { href: "/home", label: "Home", page: "CATCH_UP", icon: "home" },
  { href: "/board", label: "Todos", page: "BOARD", icon: "todos" },
  { href: "/notes", label: "Notes", page: "NOTES", icon: "notes" },
  { href: "/profiles", label: "People", page: "PROFILES", icon: "people" },
  { href: "/group-photo", label: "Group Photo", page: "GROUP_PHOTO", icon: "people" },
  { href: "/history", label: "History", page: "HISTORY", icon: "history" },
  { href: "/options", label: "Options", page: "OPTIONS", icon: "options" },
];

function Icon({ name }: { name: IconName }) {
  const paths = {
    home: <path d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" />,
    todos: <path d="M4 6h4v4H4zM4 14h4v4H4zM11 8h9M11 16h9" />,
    notes: <><path d="M6 3h9l3 3v15H6Z" /><path d="M9 11h7M9 15h5" /></>,
    people: <><circle cx="9" cy="8" r="3.4" /><path d="M3 20a6 6 0 0 1 12 0M16 5.5a3.4 3.4 0 0 1 0 6.6M18 20a5.6 5.6 0 0 0-2.4-4.6" /></>,
    history: <><path d="M4 6v5h5" /><path d="M5 11a8 8 0 1 1 2 7" /><path d="M12 8v5l3 2" /></>,
    options: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
    switch: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
    review: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    update: <path d="M12 5v14M5 12h14" />,
    glow: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2-2" /></>,
    contrast: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" /></>,
  }[name];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

function readPreference(name: string, defaultValue = false) {
  try { const value = window.localStorage.getItem(name); return value === null ? defaultValue : value === "true"; } catch { return defaultValue; }
}

export function AppNavigation({ current }: { current?: AppPage }) {
  const [glow, setGlow] = useState(() => typeof window === "undefined" || readPreference("bunch-glow", true));
  const [highContrast, setHighContrast] = useState(() => typeof window !== "undefined" && readPreference("bunch-high-contrast"));
  useEffect(() => { document.documentElement.dataset.glow = glow ? "on" : "off"; try { window.localStorage.setItem("bunch-glow", String(glow)); } catch { /* session-only */ } }, [glow]);
  useEffect(() => { document.documentElement.dataset.highContrast = highContrast ? "on" : "off"; try { window.localStorage.setItem("bunch-high-contrast", String(highContrast)); } catch { /* session-only */ } }, [highContrast]);
  useEffect(() => () => { delete document.documentElement.dataset.glow; delete document.documentElement.dataset.highContrast; }, []);
  useEffect(() => {
    const shortcuts: Record<string, string> = { s: "/home#presence-controls", r: "/home#catch-up-records", u: "/board#create-record" };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const href = shortcuts[event.key.toLowerCase()];
      if (href) { event.preventDefault(); window.location.assign(href); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return <header className="app-navigation command-topbar">
    <div className="bunch-primary-bar">
      <Link href="/home" className="command-brand" aria-label="Austen Tucker-Crowder home"><Image src="/bunch-barrel-monkeys.png" alt="" width={32} height={32} priority />Austen Tucker-Crowder</Link>
      <nav className="command-topnav" aria-label="Bunch navigation">{destinations.map(({ href, label, page, icon }) => <Link key={page} href={href} aria-current={current === page || current === "GALLERY" && page === "PROFILES" || ["BOARD", "NOTES", "THREADS"].includes(current ?? "") && page === "OPTIONS" ? "page" : undefined}><Icon name={icon} /><span>{label}</span></Link>)}</nav>
      <div className="bunch-utilities"><span className="bunch-private-pill" aria-label="Private records"><span>Private</span><span aria-hidden="true">•</span></span><button type="button" className="bunch-icon-button" onClick={() => setGlow(value => !value)} aria-pressed={glow} aria-label="Toggle glow"><Icon name="glow" /></button><button type="button" className="bunch-icon-button contrast" onClick={() => setHighContrast(value => !value)} aria-pressed={highContrast} aria-label="High contrast"><Icon name="contrast" /></button></div>
    </div>
    <nav className="bunch-verbbar" aria-label="Bunch actions"><span className="bunch-verb-label">Do</span><Link className="bunch-verb switch" href="/home#presence-controls"><Icon name="switch" />Switch <kbd>S</kbd></Link><Link className="bunch-verb review" href="/home#catch-up-records"><Icon name="review" />Review <kbd>R</kbd></Link><Link className="bunch-verb update" href="/board#create-record"><Icon name="update" />Update <kbd>U</kbd></Link><span className="bunch-verb-hint">Esc closes panels</span></nav>
  </header>;
}
