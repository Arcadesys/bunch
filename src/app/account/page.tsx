"use client";
import { useState, useMemo } from "react";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection } from "../list-detail";
import { PilotAccount } from "./pilot-account";

type AccountSectionId = "account" | "privacy" | "retention" | "laptop" | "gallery" | "invitations" | "images" | "delete";

export default function AccountPage() {
  const rows = useMemo(() => [
    { id: "account" as AccountSectionId, title: "Your private system account", meta: "Signed in" },
    { id: "privacy" as AccountSectionId, title: "Who can access your data?", meta: "Privacy" },
    { id: "retention" as AccountSectionId, title: "How catch-up and deletion work", meta: "Retention" },
    { id: "laptop" as AccountSectionId, title: "Laptop reference credentials", meta: "Working Monkey" },
    { id: "gallery" as AccountSectionId, title: "Gallery sharing", meta: "Images" },
    { id: "invitations" as AccountSectionId, title: "System invitations", meta: "Friends" },
    { id: "images" as AccountSectionId, title: "Image allowance", meta: "Budget" },
    { id: "delete" as AccountSectionId, title: "Delete this system's account", meta: "Permanent", badge: { label: "Permanent", tone: "danger" as const } },
  ], []);

  const ids = useMemo(() => rows.map(r => r.id), [rows]);
  const [selectedId, select] = useListSelection(ids);

  return <main className="app-page">
    <AppNavigation current="ACCOUNT" />
    <ListDetail
      title="Account"
      rows={rows.map(r => ({
        id: r.id,
        title: r.title,
        meta: r.meta,
        badge: r.badge,
      }))}
      selectedId={selectedId}
      onSelect={select}
    >
      <PilotAccount selectedSection={selectedId as AccountSectionId} />
    </ListDetail>
  </main>;
}
