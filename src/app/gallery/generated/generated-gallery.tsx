"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { GeneratedGalleryPage, GeneratedPhoto } from "@/domain/generated-gallery";
import { DeleteImageButton } from "../delete-image-button";

async function fetchPage(cursor?: string): Promise<GeneratedGalleryPage> {
  const response = await fetch(`/api/v1/generated-images${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
  if (response.status === 401) throw new Error("Sign in to view your private photos.");
  if (!response.ok) throw new Error("Could not load your photos. Try again.");
  return response.json();
}

function PhotoCard({ photo, onDeleted }: { photo: GeneratedPhoto; onDeleted: () => void }) {
  const [failed, setFailed] = useState(false);
  const caption = photo.description.length > 120 ? `${photo.description.slice(0, 117)}…` : photo.description;
  return <li className="generated-photo-card">
    <a className="generated-photo-preview" href={photo.imageUrl} aria-label={`Open full image: ${caption}`}>
      {failed ? <span>Preview unavailable. Open the full image to try again.</span> : <Image src={photo.imageUrl} alt={caption} width={photo.width ?? 1024} height={photo.height ?? 1024} unoptimized onError={() => setFailed(true)} />}
    </a>
    <div className="generated-photo-caption">
      <p className="eyebrow">{photo.kind === "group" ? "Group photo" : "Generated image"}</p>
      <h2>{caption}</h2>
      {caption !== photo.description && <details><summary>Read full prompt</summary><p>{photo.description}</p></details>}
      <p><time dateTime={photo.createdAt}>{new Date(photo.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></p>
      <div className="actions"><a className="button button-secondary" href={photo.imageUrl}>View full image</a><a className="button button-secondary" href={photo.sourceUrl}>Reopen scene</a><a className="button button-secondary" href={photo.imageUrl} download={`bunch-${photo.id}.jpg`}>Download</a><a className="button button-secondary" href={`/images?repairKind=${photo.kind === "scene" ? "native" : "group"}&repairId=${photo.id}`}>Repair this image</a></div>
      <DeleteImageButton url={`/api/v1/account/generated-images/${encodeURIComponent(photo.id)}?kind=${photo.kind}`} label={`${photo.kind === "group" ? "group photo" : "generated image"}: ${caption}`} onDeleted={onDeleted} />
    </div>
  </li>;
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

  return <section aria-label="Saved photos" aria-busy={busy}>
    <p role="status">{busy ? "Loading photos…" : loaded ? `${notice ? `${notice} ` : ""}${photos.length} saved photo${photos.length === 1 ? "" : "s"} shown${nextCursor ? " · more available" : ""}.` : ""}</p>
    {error && <div className="notice" role="alert"><p>{error}</p>{error.startsWith("Sign in") && <a className="button" href="/auth/login?returnTo=%2Fgallery%2Fgenerated">Sign in</a>}</div>}
    {loaded && photos.length === 0 && <div className="panel"><h2>No generated photos yet</h2><p>Images you create in Images or Group Photo will appear here when they finish.</p></div>}
    <ul className="generated-photo-grid">{photos.map(photo => <PhotoCard key={`${photo.kind}-${photo.id}`} photo={photo} onDeleted={() => { setPhotos(current => current.filter(existing => !(existing.kind === photo.kind && existing.id === photo.id))); setNotice("The image was permanently deleted."); }} />)}</ul>
    {(nextCursor || error) && <button className="button" disabled={busy} onClick={() => void loadMore()}>{busy ? "Loading…" : error ? "Try again" : "Load older photos"}</button>}
  </section>;
}
