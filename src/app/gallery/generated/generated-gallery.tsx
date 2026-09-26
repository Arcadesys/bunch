"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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

const WIDE = "(min-width: 760px)";

/** Moves focus to the list row at `index` once React has rendered it. */
function focusRow(index: number) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const rows = document.querySelectorAll<HTMLButtonElement>(".generated-gallery .ld-row");
    rows[Math.min(Math.max(index, 0), rows.length - 1)]?.focus();
  }));
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
    const date = new Date(photo.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" });
    return {
      id: photoKey(photo),
      thumb: photo.imageUrl,
      title: shortTitle(photo),
      meta: photo.kind === "group" ? date : `Made in Images · ${date}`,
    };
  }), [photos]);

  // Until the first page arrives, an empty list keeps a saved ?id= from being replaced.
  const ids = useMemo(() => loaded ? rows.map(row => row.id) : [], [loaded, rows]);
  const [selectedId, select] = useListSelection(ids);
  const index = photos.findIndex(photo => photoKey(photo) === selectedId);
  const current = index >= 0 ? photos[index] : undefined;

  const choose = useCallback((id: string | null) => {
    // Returning to the list (phones) puts focus back on the photo's tile.
    if (id === null && index >= 0) focusRow(index);
    select(id);
  }, [index, select]);

  useEffect(() => {
    if (!current) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (target instanceof Element && target !== document.body && !target.closest(".generated-gallery")) return;
      if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); select(photoKey(photos[index - 1])); }
      if (event.key === "ArrowRight" && index < photos.length - 1) { event.preventDefault(); select(photoKey(photos[index + 1])); }
      if (event.key === "Escape" && !window.matchMedia(WIDE).matches) { event.preventDefault(); choose(null); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [current, index, photos, select, choose]);

  const listStatus = <>
    <p role="status" className="ld-intro">{busy ? "Loading photos…" : loaded ? `${notice ? `${notice} ` : ""}${photos.length} photo${photos.length === 1 ? "" : "s"}${nextCursor ? " so far" : ""}.` : ""}</p>
    {error ? <div className="ld-intro gallery-alert" role="alert"><p>{error}</p>{error.startsWith("Sign in") ? <a className="button" href="/auth/login?returnTo=%2Fgallery%2Fgenerated">Sign in</a> : null}</div> : null}
    {loaded && photos.length === 0 ? <div className="ld-intro gallery-empty"><h2>No photos yet</h2><p>Images you make in Images or Group Photo land here when they finish.</p><Link className="button" href="/images">Make an image</Link></div> : null}
  </>;

  const listFooter = nextCursor || error ? <div className="ld-tools">
    <button type="button" className="button" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading…" : error ? "Try again" : "Show older photos"}</button>
  </div> : null;

  return <div className="generated-gallery">
    <ListDetail
      title="Gallery"
      count={photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : undefined}
      intro={<p>Everything you’ve made in Create images and Group photo, newest first. Only you can see these. <Link href="/images">Make an image</Link></p>}
      rows={rows}
      selectedId={current ? selectedId : null}
      onSelect={choose}
      listStatus={listStatus}
      listFooter={listFooter}
      detailLabel="Photo"
      emptyDetail={<p className="ld-empty">{loaded && photos.length === 0 ? "Your photos will appear here." : "Choose a photo from the list."}</p>}>
      {current ? <article className="detail-card" aria-labelledby="gallery-photo-title">
        <div className="gallery-photo-bar">
          <p className="gallery-photo-count">Photo {index + 1} of {photos.length}</p>
          {photos.length > 1 ? <div className="gallery-photo-nav">
            <button type="button" className="button button-secondary" aria-label="Previous photo" disabled={index === 0} onClick={() => select(photoKey(photos[index - 1]))}>← Prev</button>
            <button type="button" className="button button-secondary" aria-label="Next photo" disabled={index === photos.length - 1} onClick={() => select(photoKey(photos[index + 1]))}>Next →</button>
          </div> : null}
        </div>
        <div className="gallery-detail-image">
          {/* Private images load through the owner's session, never the public optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.imageUrl} alt={current.description} width={current.width ?? undefined} height={current.height ?? undefined} />
        </div>
        <h2 id="gallery-photo-title">{shortTitle(current)}</h2>
        <p className="detail-eyebrow">{current.kind === "group" ? "Group photo" : "Made in Images"} · {new Date(current.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
        <div className="detail-actions">
          <a className="button" href={current.imageUrl} download={`bunch-${current.id}.jpg`}>Download</a>
          <a className="button button-secondary" href={current.sourceUrl}>{current.kind === "group" ? "Reopen group photo" : "Reopen scene"}</a>
          <a className="button button-secondary" href={`/images?repairKind=${current.kind === "scene" ? "native" : "group"}&repairId=${current.id}`}>Repair this image</a>
          <DeleteImageButton key={photoKey(current)} url={`/api/v1/account/generated-images/${encodeURIComponent(current.id)}?kind=${current.kind}`} label={`${current.kind === "group" ? "group photo" : "generated image"}: ${shortTitle(current)}`} onDeleted={() => {
            const removed = current;
            setPhotos(list => list.filter(photo => !(photo.kind === removed.kind && photo.id === removed.id)));
            setNotice("The image was permanently deleted.");
            // Its tile is gone; land focus on the neighbouring tile instead of the page.
            focusRow(index >= photos.length - 1 ? index - 1 : index);
            select(null);
          }} />
        </div>
        {current.kind === "scene" && current.description !== shortTitle(current) ? <div className="detail-callout">
          <h3>Full prompt</h3>
          <p>{current.description}</p>
        </div> : null}
      </article> : null}
    </ListDetail>
  </div>;
}

function photoKey(photo: GeneratedPhoto) {
  return `${photo.kind}-${photo.id}`;
}
