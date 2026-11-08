"use client";
import Link from "next/link";
import { useMemo } from "react";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection, type ListRow } from "../list-detail";
import { ThemeControl } from "../theme-control";
import "./options.css";

const rows: ListRow[] = [
  { id: "appearance", title: "Appearance", meta: "Theme, glow, contrast" },
  { id: "install", title: "Install on your phone", meta: "Home screen" },
  { id: "connect", title: "Connect clients", meta: "ChatGPT, Codex" },
  { id: "signin", title: "Sign-in", meta: "Account access" },
];

export default function OptionsPage() {
  const ids = useMemo(() => rows.map(row => row.id), []);
  const [selectedId, select] = useListSelection(ids);
  const current = rows.find(row => row.id === selectedId);

  const more = <nav className="options-more" aria-labelledby="options-more-heading">
    <h2 id="options-more-heading">More settings</h2>
    <Link className="options-link" href="/account"><strong>Account & privacy</strong><span>Privacy, retention, and account controls.</span></Link>
  </nav>;

  return <main className="app-page">
    <AppNavigation current="OPTIONS" />
    <ListDetail title="Options" intro={<p>Appearance, saved records, and account access.</p>} rows={rows} selectedId={current ? selectedId : null} onSelect={select}
      listFooter={more} detailLabel="Option details">
      {current ? <article className="detail-card options-detail">
        {current.id === "appearance" ? <ThemeControl /> : null}
        {current.id === "install" ? <>
          <h2>Install on your phone</h2>
          <p>Add Bunch to your home screen. iPhone and Android instructions.</p>
          <div className="detail-actions"><Link href="/install" className="button">Install on your phone: open the guide</Link></div>
        </> : null}
        {current.id === "connect" ? <>
          <h2>Connect clients</h2>
          <p>Connect ChatGPT and other companions. They read and write the same records under the same rules.</p>
          <div className="detail-actions"><Link href="/connect" className="button">Open connection instructions</Link></div>
        </> : null}
        {current.id === "signin" ? <>
          <h2>Account access</h2>
          <p>Your records require sign-in. They are not published or indexed.</p>
          <div className="detail-actions">
            <a className="button" href="/auth/login">Sign in with Google</a>
            <a className="button button-secondary" href="/auth/logout">Sign out</a>
          </div>
        </> : null}
      </article> : null}
    </ListDetail>
  </main>;
}
