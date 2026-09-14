"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PresencePeriod } from "@/domain/presence";
import { FrontSwitchForm } from "./front-switch-panel";

type AppPage = "CATCH_UP" | "BOARD" | "NOTES" | "THREADS" | "HISTORY" | "PROFILES" | "GALLERY" | "GROUP_PHOTO" | "IMAGES" | "OPTIONS";
type IconName = "home" | "todos" | "notes" | "people" | "history" | "options" | "switch" | "review" | "update" | "glow" | "contrast";
const destinations: { href: string; label: string; page: AppPage; icon: IconName }[] = [
  { href: "/home", label: "Home", page: "CATCH_UP", icon: "home" },
  { href: "/board", label: "Todos", page: "BOARD", icon: "todos" },
  { href: "/notes", label: "Notes", page: "NOTES", icon: "notes" },
  { href: "/profiles", label: "People", page: "PROFILES", icon: "people" },
  { href: "/group-photo", label: "Group Photo", page: "GROUP_PHOTO", icon: "people" },
  { href: "/images", label: "Images", page: "IMAGES", icon: "glow" },
  { href: "/history", label: "History", page: "HISTORY", icon: "history" },
  { href: "/options", label: "Options", page: "OPTIONS", icon: "options" },
];

// Other mounted components refresh their own presence reads from this, because
// every page mounts its own navigation and there is no shared layout state.
export const PRESENCE_CHANGED_EVENT = "bunch:presence-changed";

type Presence = { hosting: PresencePeriod | null; fronting: PresencePeriod[] };
type PresenceRead =
  | { status: "LOADING" }
  | { status: "SIGNED_OUT" }
  | { status: "ERROR" }
  | { status: "READY"; presence: Presence };

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

// The accessible name carries the whole recorded state; the visible text is
// abbreviated to keep the header from reflowing on a long name.
function switchLabel(read: PresenceRead) {
  if (read.status === "LOADING") return "Switch. Reading hosting and fronting.";
  if (read.status === "SIGNED_OUT") return "Switch. Sign in to read hosting and fronting.";
  if (read.status === "ERROR") return "Switch. Hosting and fronting could not be read.";
  const hosting = read.presence.hosting
    ? `Hosting: ${read.presence.hosting.alterName}.`
    : "No hosting period is recorded.";
  const fronting = read.presence.fronting.length
    ? `Fronting alongside: ${read.presence.fronting.map(p => p.alterName).join(", ")}.`
    : "No open fronting episodes are recorded.";
  return `Switch. ${hosting} ${fronting}`;
}

// "Host" and "Also" are what separate the two roles. Never colour or order alone.
function switchSummary(read: PresenceRead) {
  if (read.status === "LOADING") return { host: "Reading…", fronting: "" };
  if (read.status === "SIGNED_OUT") return { host: "Sign in to read", fronting: "" };
  if (read.status === "ERROR") return { host: "Not read", fronting: "" };
  const [first, ...rest] = read.presence.fronting;
  return {
    host: `Host ${read.presence.hosting?.alterName ?? "not recorded"}`,
    fronting: first ? `Also ${first.alterName}${rest.length ? ` +${rest.length}` : ""}` : "",
  };
}

function readPreference(name: string, defaultValue = false) {
  try { const value = window.localStorage.getItem(name); return value === null ? defaultValue : value === "true"; } catch { return defaultValue; }
}

export function AppNavigation({ current }: { current?: AppPage }) {
  const [glow, setGlow] = useState(() => typeof window === "undefined" || readPreference("bunch-glow", true));
  const [highContrast, setHighContrast] = useState(() => typeof window !== "undefined" && readPreference("bunch-high-contrast"));
  const [switchOpen, setSwitchOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [presenceRefresh, setPresenceRefresh] = useState(0);
  const [read, setRead] = useState<PresenceRead>({ status: "LOADING" });
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { document.documentElement.dataset.glow = glow ? "on" : "off"; try { window.localStorage.setItem("bunch-glow", String(glow)); } catch { /* session-only */ } }, [glow]);
  useEffect(() => { document.documentElement.dataset.highContrast = highContrast ? "on" : "off"; try { window.localStorage.setItem("bunch-high-contrast", String(highContrast)); } catch { /* session-only */ } }, [highContrast]);
  useEffect(() => () => { delete document.documentElement.dataset.glow; delete document.documentElement.dataset.highContrast; }, []);
  // A failed read never surfaces an error in the header; signed-out pages mount
  // this navigation too, and the button still opens.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/presence/current", { cache: "no-store", signal: controller.signal });
        if (!response.ok) { if (!controller.signal.aborted) setRead({ status: response.status === 401 ? "SIGNED_OUT" : "ERROR" }); return; }
        const payload = await response.json();
        if (!controller.signal.aborted) setRead({ status: "READY", presence: { hosting: payload.data.hosting ?? null, fronting: payload.data.fronting ?? [] } });
      } catch {
        if (!controller.signal.aborted) setRead({ status: "ERROR" });
      }
    })();
    return () => controller.abort();
  }, [presenceRefresh]);
  const openSwitch = useCallback(() => { setNotice(""); setSwitchOpen(true); }, []);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (switchOpen && !element.open) element.showModal();
    if (!switchOpen && element.open) element.close();
  }, [switchOpen]);
  useEffect(() => {
    const shortcuts: Record<string, string> = { r: "/home#catch-up-records", u: "/board#create-record" };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      // Switching is handled here rather than by navigating, so it works from
      // every page. The open dialog owns the keyboard while it is showing.
      if (key === "s") { if (switchOpen) return; event.preventDefault(); openSwitch(); return; }
      const href = shortcuts[key];
      if (href) { event.preventDefault(); window.location.assign(href); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [switchOpen, openSwitch]);
  const summary = switchSummary(read);
  return <header className="app-navigation command-topbar">
    <div className="bunch-primary-bar">
      <Link href="/home" className="command-brand" aria-label="Bunch home"><Image src="/bunch-barrel-monkeys.png" alt="" width={32} height={32} priority />Bunch</Link>
      <nav className="command-topnav" aria-label="Bunch navigation">{destinations.map(({ href, label, page, icon }) => <Link key={page} href={href} aria-current={current === page || current === "GALLERY" && page === "PROFILES" || ["BOARD", "NOTES", "THREADS"].includes(current ?? "") && page === "OPTIONS" ? "page" : undefined}><Icon name={icon} /><span>{label}</span></Link>)}</nav>
      <button type="button" ref={trigger} className="bunch-switch-action" aria-haspopup="dialog" aria-expanded={switchOpen} aria-keyshortcuts="s" aria-label={switchLabel(read)} onClick={openSwitch}>
        <Icon name="switch" />
        <span className="bunch-switch-text">
          <span className="bunch-switch-word" aria-hidden="true">Switch <kbd>S</kbd></span>
          <span className="bunch-switch-presence" aria-hidden="true">
            <span>{summary.host}</span>
            {summary.fronting ? <span>{summary.fronting}</span> : null}
          </span>
        </span>
      </button>
      <div className="bunch-utilities"><span className="bunch-private-pill" aria-label="Private records"><span>Private</span><span aria-hidden="true">•</span></span><button type="button" className="bunch-icon-button" onClick={() => setGlow(value => !value)} aria-pressed={glow} aria-label="Toggle glow"><Icon name="glow" /></button><button type="button" className="bunch-icon-button contrast" onClick={() => setHighContrast(value => !value)} aria-pressed={highContrast} aria-label="High contrast"><Icon name="contrast" /></button></div>
    </div>
    <nav className="bunch-verbbar" aria-label="Bunch actions"><span className="bunch-verb-label">Do</span><Link className="bunch-verb review" href="/home#catch-up-records"><Icon name="review" />Review <kbd>R</kbd></Link><Link className="bunch-verb update" href="/board#create-record"><Icon name="update" />Update <kbd>U</kbd></Link><span className="bunch-verb-hint">Esc closes panels</span></nav>
    {notice ? <p className="bunch-switch-notice" role="status">{notice}</p> : null}
    <dialog className="bunch-switch-dialog" ref={dialog} aria-label="Hosting and fronting" onClose={() => { setSwitchOpen(false); trigger.current?.focus(); }}>
      {switchOpen ? <FrontSwitchForm
        headingId="nav-presence-change-heading"
        onClose={() => setSwitchOpen(false)}
        onNotice={setNotice}
        onConfirmed={periodId => { setPresenceRefresh(value => value + 1); window.dispatchEvent(new CustomEvent(PRESENCE_CHANGED_EVENT, { detail: { periodId } })); }}
      /> : null}
    </dialog>
  </header>;
}
