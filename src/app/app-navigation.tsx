"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SwitchDock } from "./switch-dock";

export { PRESENCE_CHANGED_EVENT } from "./switch-dock";

type AppPage = "CATCH_UP" | "BOARD" | "NOTES" | "THREADS" | "HISTORY" | "PROFILES" | "GALLERY" | "GROUP_PHOTO" | "IMAGES" | "OPTIONS";

function Icon({ name }: { name: "home" | "options" | "contrast" }) {
  const paths = {
    home: <path d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" />,
    options: <><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1-2.1" /></>,
    contrast: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none" /></>,
  }[name];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

export function AppNavigation({ current }: { current?: AppPage }) {
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
  return <header className="app-navigation command-topbar">
    <div className="bunch-primary-bar">
      <Link href="/home" className="command-brand" aria-label="Bunch home"><Image src="/bunch-barrel-monkeys.png" alt="" width={38} height={38} priority />Bunch</Link>
      <span className="bunch-private-pill" aria-label="Private records">▢ <span>Private</span></span>
      <nav className="compact-nav" aria-label="Bunch navigation">
        <Link href="/home" aria-current={current === "CATCH_UP" ? "page" : undefined}><Icon name="home"/><span>Home</span></Link>
        <Link href="/options" aria-current={current === "OPTIONS" ? "page" : undefined}><Icon name="options"/><span>Options</span></Link>
      </nav>
      <button type="button" className="bunch-icon-button contrast" onClick={toggleContrast} aria-pressed={highContrast} aria-label="High contrast on this device"><Icon name="contrast" /></button>
    </div>
    <SwitchDock />
  </header>;
}
