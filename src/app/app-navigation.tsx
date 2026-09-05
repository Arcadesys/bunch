import Link from "next/link";
import Image from "next/image";
import { ThemeControl } from "./theme-control";

type AppPage = "CATCH_UP" | "BOARD" | "NOTES" | "THREADS" | "HISTORY" | "PROFILES" | "GALLERY";

const destinations: { href: string; label: string; page: AppPage }[] = [
  { href: "/", label: "Catch-up", page: "CATCH_UP" },
  { href: "/board", label: "Board", page: "BOARD" },
  { href: "/notes", label: "Notes", page: "NOTES" },
  { href: "/threads", label: "Threads", page: "THREADS" },
  { href: "/history", label: "History", page: "HISTORY" },
  { href: "/profiles", label: "Profiles & Media", page: "PROFILES" },
];

export function AppNavigation({ current }: { current?: AppPage }) {
  return <header className="command-topbar app-navigation">
    <Link href="/" className="command-brand" aria-label="DIDdy home"><Image src="/plural-rings.svg" alt="" width={48} height={48} />DIDdy</Link>
    <nav className="command-topnav" aria-label="DIDdy navigation">
      {destinations.map(({ href, label, page }) => <Link key={page} href={href} aria-current={current === page || (current === "GALLERY" && page === "PROFILES") ? "page" : undefined}>{label}</Link>)}
    </nav>
    <details className="app-preferences">
      <summary aria-label="Appearance and sign-in options">Options</summary>
      <div className="app-preferences-content"><ThemeControl /><a className="command-account" href="/auth/login">Sign in with Google</a></div>
    </details>
  </header>;
}
