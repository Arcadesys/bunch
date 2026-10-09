"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CatchUpItem, CatchUpSession } from "@/domain/catch-up";
import { AppNavigation } from "../app-navigation";
import "./home-launcher.css";

type LoadState = "loading" | "ready" | "unauthorized" | "error";

function Icon({ name }: { name: "resume" | "note" | "todo" | "people" | "quiet" | "more" }) {
  const paths = {
    resume: <><circle cx="7" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="12" r="1"/></>,
    note: <><path d="M6 3h9l3 3v15H6Z"/><path d="M9 11h6M9 15h5"/></>,
    todo: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 3 3 6-7"/></>,
    people: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M18 20a5 5 0 0 0-2-4"/></>,
    quiet: <path d="M3 13c3-6 6 6 9 0s6 6 9 0"/>,
    more: <><circle cx="6" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="18" cy="12" r="1"/></>,
  }[name];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>;
}

function LauncherRow({ href, icon, title, detail, primary = false }: { href: string; icon: Parameters<typeof Icon>[0]["name"]; title: string; detail: string; primary?: boolean }) {
  return <Link className={`home-launcher-row${primary ? " primary" : ""}`} href={href}><Icon name={icon}/><span><strong>{title}</strong><small>{detail}</small></span><span className="home-launcher-arrow" aria-hidden="true">›</span></Link>;
}

function priority(item: CatchUpItem) {
  return Number(/BLOCKED/.test(item.statusLabel ?? "")) * 4 + Number(/HIGH/.test(item.statusLabel ?? "")) * 2 + Number(item.itemType === "TODO");
}

export function HomeLauncher() {
  const [state, setState] = useState<LoadState>("loading");
  const [session, setSession] = useState<CatchUpSession | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/catch-up/current", { headers: { "x-system-demo": "local" }, cache: "no-store", signal: controller.signal }).then(async response => {
      if (response.status === 401) { setState("unauthorized"); return; }
      if (!response.ok) throw new Error();
      const payload = await response.json(); setSession(payload.data); setState("ready");
    }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, []);
  const next = useMemo(() => session?.items.filter(item => item.reviewState === "NEW").sort((a, b) => priority(b) - priority(a) || b.timestamp.localeCompare(a.timestamp))[0], [session]);
  const recordHref = next ? `${next.itemType === "TODO" ? "/board" : next.itemType === "THREAD" ? "/threads" : next.itemType === "NOTE" ? "/notes" : "/decisions"}#record-${next.itemId}` : "/board";
  return <main className="app-page"><AppNavigation current="CATCH_UP"/><div className="app-page-body">
    <div className="home-launcher-layout">
      <section className="home-launcher-main" aria-labelledby="launcher-heading"><header><h1 id="launcher-heading">What would help right now?</h1><p>Choose one place to begin.</p></header>
        <nav className="home-launcher-actions" aria-label="Things you can do">
          <LauncherRow primary href="/home/catch-up" icon="resume" title="Resume my day" detail="Read my catch-up and choose a next step."/>
          <LauncherRow href="/home/quiet" icon="quiet" title="I’m overwhelmed" detail="Take a quieter path. You can always come back."/>
          <LauncherRow href="/notes#create-record" icon="note" title="Leave a note" detail="Quickly capture a thought."/>
          <LauncherRow href="/board" icon="todo" title="Manage todos" detail="See what needs attention."/>
          <LauncherRow href="/profiles" icon="people" title="People & pictures" detail="View profiles and saved pictures."/>
        </nav>
        <details className="home-launcher-more"><summary><Icon name="more"/><span><strong>More places</strong><small>Save a thread, history, and options.</small></span></summary><nav aria-label="More places"><Link href="/threads#create-record">Save a thread</Link><Link href="/history">History</Link><Link href="/options">Options</Link></nav></details>
      </section>
      <aside className="home-right-now" aria-labelledby="right-now-heading"><div className="home-right-now-heading"><h2 id="right-now-heading">Right now</h2>{session ? <p><strong>{session.reviewedCount} of {session.totalCount}</strong> reviewed</p> : null}</div>
        {session ? <div className="home-launcher-progress" aria-label={`${session.reviewedCount} of ${session.totalCount} reviewed`}><span style={{ width: `${session.totalCount ? session.reviewedCount / session.totalCount * 100 : 100}%` }}/></div> : null}
        {state === "loading" ? <p role="status">Reading your catch-up…</p> : state === "unauthorized" ? <><p>Sign in to read private records.</p><a className="command-button" href="/auth/login">Sign in with Google</a></> : state === "error" ? <p role="alert">Catch-up could not be read. Your saved tools are still available.</p> : <section className="home-next-step"><h3>Next step</h3><p><strong>{next?.title ?? "Choose one saved task"}</strong></p><p>{next?.nextAction ?? "Open Todos when you’re ready."}</p><Link className="command-button" href={recordHref}>Open todo <span aria-hidden="true">›</span></Link></section>}
      </aside>
    </div>
  </div></main>;
}
