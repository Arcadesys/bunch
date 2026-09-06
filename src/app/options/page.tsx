import Link from "next/link";
import { AppNavigation } from "../app-navigation";
import { ThemeControl } from "../theme-control";
export default function OptionsPage() {
  return <main className="shell"><AppNavigation current="OPTIONS" /><header className="command-hero"><p className="command-kicker">Your private companion</p><h1>Options</h1><p>Saved records, appearance, and account access.</p></header>
    <div className="options-grid">{[
      ["/account", "Account & privacy", "Privacy, retention, and account controls."],
      ["/connect", "Connect clients", "Connect ChatGPT and other companions."],
      ["/board", "Board", "Assigned and System-wide todos."],
      ["/notes", "Notes", "Messages for a person or the System."],
      ["/threads", "Threads", "Saved links and approved summaries."],
      ["/decisions", "Decisions", "Recorded decisions and next actions."],
      ["/profiles#coverage-heading", "Coverage records", "Drafts and confirmed responsibility records."],
      ["/gallery", "Private gallery", "Browse stored profile images."],
    ].map(([href, title, detail]) => <Link className="option-card" key={href} href={href}><h2>{title}</h2><p>{detail}</p><span aria-hidden="true">Open →</span></Link>)}</div>
    <section className="panel"><h2>Appearance</h2><ThemeControl /></section>
    <section className="panel"><h2>Account</h2><p>Your records require sign-in. They are not published or indexed.</p><a className="button" href="/auth/login">Sign in with Google</a><a className="button button-secondary" href="/auth/logout">Sign out</a></section>
  </main>;
}
