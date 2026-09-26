"use client";

import Link from "next/link";
import { useMemo, useEffect, useState } from "react";
import type { GeneratedGalleryPage, GeneratedPhoto } from "@/domain/generated-gallery";
import { ListDetail, useListSelection, type ListRow } from "@/app/list-detail";
import { DeleteImageButton } from "../delete-image-button";
import "../gallery.css";

async function fetchPage(cursor?: string): Promise<GeneratedGalleryPage> {
  const response = await fetch(`/api/v1/generated-images${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
  if (response.status === 401) throw new Error("Sign in to view your private photos.");
  if (!response.ok) throw new Error("Could not load your photos. Try again.");
  return response.json();
}

/** A tile needs a glanceable name, not the whole prompt: cut at the first clause. */
function shortTitle(photo: GeneratedPhoto) {
  if (photo.kind === "group") return "Group photo";
  const firstClause = photo.description.split(/[,.;\n]/, 1)[0].trim() || photo.description;
  if (firstClause.length <= 60) return firstClause;
  const cut = firstClause.slice(0, 58);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 58).trimEnd()}…`;
}

export function GeneratedGallery() {
  const [photos, setPhotos] = useState<GeneratedPhoto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchPage().then(page => { if (active) { setPhotos(page.data); setNextCursor(page.meta.nextCursor); setLoaded(true); } })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : "Could not load your photos."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  async function loadMore() {
    setBusy(true); setError(null);
    try {
      const page = await fetchPage(loaded ? nextCursor ?? undefined : undefined);
      setPhotos(current => [...current, ...page.data.filter(photo => !current.some(existing => existing.kind === photo.kind && existing.id === photo.id))]);
      setNextCursor(page.meta.nextCursor); setLoaded(true);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load your photos."); }
    finally { setBusy(false); }
  }

  const rows: ListRow[] = useMemo(() => photos.map(photo => {
    const title = shortTitle(photo);
    const kind = photo.kind === "group" ? "Group photo" : "Made in Images";
    const date = new Date(photo.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" });
    return {
      id: `${photo.kind}-${photo.id}`,
      thumb: photo.imageUrl,
      title,
      meta: photo.kind === "group" ? date : `${kind} · ${date}`,
    };
  }), [photos]);

  const ids = useMemo(() => rows.map(row => row.id), [rows]);
  const [selectedId, select] = useListSelection(ids);
  const current = photos.find(p => `${p.kind}-${p.id}` === selectedId);

  const listStatus = busy || !loaded
    ? <div className="ld-intro" role="status">{busy ? "Loading photos…" : ""}</div>
    : error
    ? <div className="ld-intro" role="alert">
        <p>{error}</p>
        {error.startsWith("Sign in") && <a className="button" href="/auth/login?returnTo=%2Fgallery%2Fgenerated">Sign in</a>}
      </div>
    : loaded && photos.length === 0
    ? <div className="ld-intro"><p>No photos yet. Images you make in Images or Group Photo land here when they finish.</p></div>
    : null;

  const listTools = nextCursor || error ? <div className="ld-tools">
    <button className="button" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading…" : error ? "Try again" : "Load older photos"}</button>
  </div> : null;

  return <ListDetail
    title="Gallery"
    count={photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}${nextCursor ? " so far" : ""}` : undefined}
    intro={<p>Images from Create images and Group photo, newest first.</p>}
    rows={rows}
    selectedId={selectedId}
    onSelect={select}
    listStatus={listStatus}
    listTools={listTools}>
    {current ? <article className="detail-card" id={`photo-${selectedId}`}>
      <div className="gallery-detail-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.imageUrl} alt={current.description} />
      </div>
      <h2>{shortTitle(current)}</h2>
      <span className="detail-eyebrow">{current.kind === "group" ? "Group photo" : "Made in Images"} · {new Date(current.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
      <div className="detail-actions">
        <a className="button" href={current.imageUrl} download={`bunch-${current.id}.jpg`}>Download</a>
        <a className="button button-secondary" href={current.sourceUrl}>{current.kind === "group" ? "Reopen group photo" : "Reopen scene"}</a>
        <a className="button button-secondary" href={`/images?repairKind=${current.kind === "scene" ? "native" : "group"}&repairId=${current.id}`}>Repair this image</a>
        <DeleteImageButton url={`/api/v1/account/generated-images/${encodeURIComponent(current.id)}?kind=${current.kind}`} label={`${current.kind === "group" ? "group photo" : "generated image"}: ${shortTitle(current)}`} onDeleted={() => {
          setPhotos(p => p.filter(ph => !(ph.kind === current.kind && ph.id === current.id)));
          setNotice("The image was permanently deleted.");
        }} />
      </div>
      {current.kind === "scene" && current.description !== shortTitle(current) && <div className="detail-callout">
        <span className="detail-eyebrow">Full prompt</span>
        <p>{current.description}</p>
      </div>}
      {notice && <p role="status">{notice}</p>}
    </article> : null}
  </ListDetail>;
}
