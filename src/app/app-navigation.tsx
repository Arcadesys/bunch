"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SwitchDock } from "./switch-dock";

export { PRESENCE_CHANGED_EVENT } from "./switch-dock";

export type AppPage =
  | "CATCH_UP" | "REVIEW"
  | "NOTES" | "BOARD" | "THREADS" | "DECISIONS" | "HISTORY" | "COVERAGE"
  | "PROFILES" | "GALLERY" | "PHOTOS" | "GROUP_PHOTO" | "IMAGES" | "STICKERS"
  | "OPTIONS" | "ACCOUNT";

// One section list drives the wide sidebar and the narrow drawer.
export const NAV_GROUPS: readonly { label: string; items: readonly { id: AppPage; href: string; label: string }[] }[] = [
  { label: "Today", items: [
    { id: "CATCH_UP", href: "/home", label: "Home" },
    { id: "REVIEW", href: "/home/catch-up", label: "Catch-up" },
  ] },
  { label: "Records", items: [
    { id: "NOTES", href: "/notes", label: "Notes" },
    { id: "BOARD", href: "/board", label: "Todos" },
    { id: "THREADS", href: "/threads", label: "Threads" },
    { id: "DECISIONS", href: "/decisions", label: "Decisions" },
    { id: "HISTORY", href: "/history", label: "History" },
    { id: "COVERAGE", href: "/coverage", label: "Coverage" },
  ] },
  { label: "People", items: [
    { id: "PROFILES", href: "/profiles", label: "People" },
    { id: "GALLERY", href: "/gallery/generated", label: "Gallery" },
    { id: "PHOTOS", href: "/gallery", label: "Profile photos" },
    { id: "GROUP_PHOTO", href: "/group-photo", label: "Group photo" },
    { id: "IMAGES", href: "/images", label: "Create images" },
    { id: "STICKERS", href: "/stickers", label: "Sticker lab" },
  ] },
  { label: "Settings", items: [
    { id: "OPTIONS", href: "/options", label: "Options" },
    { id: "ACCOUNT", href: "/account", label: "Account" },
  ] },
];

function Icon({ name }: { name: "menu" | "close" | "contrast" }) {
  const paths = {
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    close: <path d="M6 6l12 12M18 6 6 18" />,
    contrast: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" /></>,
  }[name];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

function ContrastButton({ className }: { className: string }) {
  const [highContrast, setHighContrast] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHighContrast(localStorage.getItem("bunch-high-contrast") === "true"));
    return () => cancelAnimationFrame(frame);
  }, []);
  const toggleContrast = () => {
    const next = !highContrast; setHighContrast(next);
    document.documentElement.dataset.highContrast = next ? "on" : "off";
    localStorage.setItem("bunch-high-contrast", String(next));
  };
  return <button type="button" className={`bunch-icon-button contrast ${className}`} onClick={toggleContrast} aria-pressed={highContrast} aria-label="High contrast on this device"><Icon name="contrast" /></button>;
}

export function AppNavigation({ current }: { current?: AppPage }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);
  const title = NAV_GROUPS.flatMap(group => group.items).find(item => item.id === current)?.label ?? "Bunch";

  useEffect(() => {
    if (!menuOpen) return;
    nav.current?.querySelector<HTMLElement>("a[aria-current='page'], a")?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    menuButton.current?.focus();
  }

  return <header className="app-navigation app-shell-nav" data-menu-open={menuOpen ? "true" : "false"}>
    <div className="app-topbar">
      <button ref={menuButton} type="button" className="bunch-icon-button app-menu-button" aria-label="Open sections" aria-expanded={menuOpen} aria-controls="bunch-sections" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
      <Link href="/home" className="command-brand" aria-label="Bunch home"><Image src="/bunch-barrel-monkeys.png" alt="" width={32} height={32} priority /></Link>
      <span className="app-topbar-title">{title}</span>
      <ContrastButton className="app-topbar-contrast" />
    </div>
    <nav ref={nav} id="bunch-sections" className="app-sidebar" aria-label="Bunch navigation">
      <div className="app-sidebar-brand">
        <Link href="/home" className="command-brand" aria-label="Bunch home" onClick={() => setMenuOpen(false)}><Image src="/bunch-barrel-monkeys.png" alt="" width={32} height={32} /><span>Bunch</span></Link>
        <span className="bunch-private-pill" aria-label="Private records">Private</span>
        <button type="button" className="bunch-icon-button app-menu-close" aria-label="Close sections" onClick={closeMenu}><Icon name="close" /></button>
      </div>
      {NAV_GROUPS.map(group => <div className="app-sidebar-group" key={group.label} role="group" aria-labelledby={`nav-group-${group.label}`}>
        <span className="app-sidebar-label" id={`nav-group-${group.label}`}>{group.label}</span>
        {group.items.map(item => <Link key={item.id} href={item.href} aria-current={item.id === current ? "page" : undefined} onClick={() => setMenuOpen(false)}>{item.label}</Link>)}
      </div>)}
      <ContrastButton className="app-sidebar-contrast" />
    </nav>
    {menuOpen ? <div className="app-drawer-scrim" aria-hidden="true" onClick={closeMenu} /> : null}
    <SwitchDock />
  </header>;
}
