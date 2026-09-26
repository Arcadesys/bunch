"use client";

import { useEffect, useState } from "react";
import type { GeneratedGalleryPage, GeneratedPhoto } from "@/domain/generated-gallery";
import { DeleteImageButton } from "../delete-image-button";
import { PhotoAlbum, type AlbumPhoto } from "../photo-album";

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

function toAlbumPhoto(photo: GeneratedPhoto, onDeleted: () => void): AlbumPhoto {
  const title = shortTitle(photo);
  const kind = photo.kind === "group" ? "Group photo" : "Made in Images";
  const date = new Date(photo.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" });
  return {
    key: `${photo.kind}-${photo.id}`,
    src: photo.imageUrl,
    alt: photo.description,
    title,
    meta: photo.kind === "group" ? date : `${kind} · ${date}`,
    details: photo.kind === "scene" && photo.description !== title ? photo.description : undefined,
    width: photo.width ?? undefined,
    height: photo.height ?? undefined,
    actions: <>
      <a className="button" href={photo.imageUrl} download={`bunch-${photo.id}.jpg`}>Download</a>
      <a className="button button-secondary" href={photo.sourceUrl}>{photo.kind === "group" ? "Reopen group photo" : "Reopen scene"}</a>
      <a className="button button-secondary" href={`/images?repairKind=${photo.kind === "scene" ? "native" : "group"}&repairId=${photo.id}`}>Repair this image</a>
      <DeleteImageButton url={`/api/v1/account/generated-images/${encodeURIComponent(photo.id)}?kind=${photo.kind}`} label={`${photo.kind === "group" ? "group photo" : "generated image"}: ${title}`} onDeleted={onDeleted} />
    </>,
  };
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

  const album = photos.map(photo => toAlbumPhoto(photo, () => {
    setPhotos(current => current.filter(existing => !(existing.kind === photo.kind && existing.id === photo.id)));
    setNotice("The image was permanently deleted.");
  }));

  return <section aria-label="Saved photos" aria-busy={busy}>
    <p role="status" className="album-status">{busy ? "Loading photos…" : loaded ? `${notice ? `${notice} ` : ""}${photos.length} photo${photos.length === 1 ? "" : "s"}${nextCursor ? " so far" : ""}.` : ""}</p>
    {error && <div className="notice" role="alert"><p>{error}</p>{error.startsWith("Sign in") && <a className="button" href="/auth/login?returnTo=%2Fgallery%2Fgenerated">Sign in</a>}</div>}
    {loaded && photos.length === 0 && <div className="panel"><h2>No photos yet</h2><p>Images you make in Images or Group Photo land here when they finish.</p><a className="button" href="/images">Make an image</a></div>}
    {photos.length > 0 && <PhotoAlbum photos={album} label="Your photos, newest first" />}
    {(nextCursor || error) && <button className="button album-more" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading…" : error ? "Try again" : "Show older photos"}</button>}
  </section>;
}
