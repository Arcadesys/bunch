"use client";
import Link from "next/link";
import { useState, useMemo } from "react";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection } from "../list-detail";
import { ThemeControl } from "../theme-control";

type OptionId = "appearance" | "install" | "connect" | "signin";

export default function OptionsPage() {
  const rows = useMemo(() => [
    { id: "appearance" as OptionId, title: "Appearance", meta: "Theme, glow, contrast" },
    { id: "install" as OptionId, title: "Install on your phone", meta: "Home screen" },
    { id: "connect" as OptionId, title: "Connect clients", meta: "ChatGPT, Codex" },
    { id: "signin" as OptionId, title: "Sign-in", meta: "Account access" },
  ], []);

  const ids = useMemo(() => rows.map(r => r.id), [rows]);
  const [selectedId, select] = useListSelection(ids);
  const current = rows.find(r => r.id === selectedId);

  return <main className="app-page">
    <AppNavigation current="OPTIONS" />
    <ListDetail
      title="Options"
      rows={rows}
      selectedId={selectedId}
      onSelect={select}
    >
      {current && (
        <article className="detail-card">
          {current.id === "appearance" && <ThemeControl />}
          {current.id === "install" && (
            <>
              <h2>Install on your phone</h2>
              <p>Add Bunch to your home screen. iPhone and Android instructions.</p>
              <Link href="/install" className="button">View installation guide</Link>
            </>
          )}
          {current.id === "connect" && (
            <>
              <h2>Connect clients</h2>
              <p>Connect ChatGPT and other companions. They read and write the same records under the same rules.</p>
              <p>Add this MCP endpoint in your client:</p>
              <code>https://bunch.thearcades.me/mcp</code>
              <button className="button" onClick={() => {
                navigator.clipboard.writeText("https://bunch.thearcades.me/mcp");
              }}>Copy endpoint</button>
            </>
          )}
          {current.id === "signin" && (
            <>
              <h2>Account access</h2>
              <p>Your records require sign-in. They are not published or indexed.</p>
              <div className="detail-actions">
                <a className="button" href="/auth/login">Sign in with Google</a>
                <a className="button button-secondary" href="/auth/logout">Sign out</a>
                <Link href="/account" className="button button-secondary">Account & privacy →</Link>
              </div>
            </>
          )}
        </article>
      )}
    </ListDetail>
  </main>;
}
