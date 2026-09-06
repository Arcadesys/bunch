import Link from "next/link";
import Image from "next/image";

type AppPage = "CATCH_UP" | "BOARD" | "NOTES" | "THREADS" | "HISTORY" | "PROFILES" | "GALLERY" | "OPTIONS";
const destinations: { href: string; label: string; page: AppPage }[] = [
  { href: "/", label: "Catch-up", page: "CATCH_UP" },
  { href: "/history", label: "History", page: "HISTORY" },
  { href: "/profiles", label: "People", page: "PROFILES" },
  { href: "/options", label: "Options", page: "OPTIONS" },
];
export function AppNavigation({ current }: { current?: AppPage }) {
  return <header className="command-topbar app-navigation">
    <Link href="/" className="command-brand" aria-label="DIDdy home"><Image src="/plural-rings.svg" alt="" width={40} height={40} />DIDdy</Link>
    <nav className="command-topnav" aria-label="DIDdy navigation">{destinations.map(({ href, label, page }) => <Link key={page} href={href} aria-current={current === page || current === "GALLERY" && page === "PROFILES" || ["BOARD", "NOTES", "THREADS"].includes(current ?? "") && page === "OPTIONS" ? "page" : undefined}>{label}</Link>)}</nav>
  </header>;
}
