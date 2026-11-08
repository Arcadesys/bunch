"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export type AlbumPhoto = {
  key: string;
  src: string;
  /** Describes the picture itself; shown to screen readers in the viewer. */
  alt: string;
  title: string;
  meta?: string;
  /** Longer text shown under the actions, e.g. a scene's full prompt. */
  details?: string;
  width?: number;
  height?: number;
  /** Everything you can do with this photo lives in the viewer, not on the tile. */
  actions: ReactNode;
};

/**
 * Photo-first grid: each tile is one button that opens a full-size viewer with the
 * photo's actions and Previous/Next. The open photo is tracked by key, so deleting it
 * closes the viewer instead of silently showing its neighbour.
 */
export function PhotoAlbum({ photos, label }: { photos: AlbumPhoto[]; label: string }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const index = openKey === null ? -1 : photos.findIndex((photo) => photo.key === openKey);

  useEffect(() => {
    // The open photo vanished (deleted). The viewer closes itself; its tile is gone
    // too, so land focus on the album rather than letting it fall to the page.
    if (openKey !== null && index === -1) listRef.current?.focus();
  }, [openKey, index]);

  return <>
    <ul className="photo-grid" aria-label={label} ref={listRef} tabIndex={-1}>
      {photos.map((photo) => <li key={photo.key} className="photo-tile">
        <button type="button" className="photo-tile-open" aria-haspopup="dialog" onClick={() => setOpenKey(photo.key)}>
          <span className="photo-tile-frame">
            <Image src={photo.src} alt="" width={480} height={480} sizes="(max-width: 600px) 100vw, 320px" loading="lazy" unoptimized />
          </span>
          <span className="photo-tile-title">{photo.title}</span>
          {photo.meta && <span className="photo-tile-meta">{photo.meta}</span>}
        </button>
      </li>)}
    </ul>
    <PhotoViewer photos={photos} index={index} onMove={(next) => setOpenKey(photos[next].key)} onClose={() => setOpenKey(null)} />
  </>;
}

function PhotoViewer({ photos, index, onMove, onClose }: { photos: AlbumPhoto[]; index: number; onMove: (index: number) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const photo = index >= 0 ? photos[index] : undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (photo && !dialog.open) dialog.showModal();
    if (!photo && dialog.open) dialog.close();
  }, [photo]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); onMove(index - 1); }
    if (event.key === "ArrowRight" && index < photos.length - 1) { event.preventDefault(); onMove(index + 1); }
  }

  return <dialog ref={dialogRef} className="photo-viewer" aria-labelledby={titleId} onClose={onClose} onKeyDown={onKeyDown}>
    {photo && <div className="photo-viewer-body" key={photo.key}>
      <div className="photo-viewer-bar">
        <p className="photo-viewer-count">Photo {index + 1} of {photos.length}</p>
        <div className="photo-viewer-nav">
          {photos.length > 1 && <>
            <button type="button" className="button button-secondary" aria-label="Previous photo" disabled={index === 0} onClick={() => onMove(index - 1)}>← Prev</button>
            <button type="button" className="button button-secondary" aria-label="Next photo" disabled={index === photos.length - 1} onClick={() => onMove(index + 1)}>Next →</button>
          </>}
          <button type="button" className="button" onClick={() => dialogRef.current?.close()}>Close</button>
        </div>
      </div>
      <div className="photo-viewer-stage">
        <Image src={photo.src} alt={photo.alt} width={photo.width ?? 1024} height={photo.height ?? 1024} sizes="(max-width: 1000px) 100vw, 640px" unoptimized />
      </div>
      <div className="photo-viewer-side">
        <div className="photo-viewer-info">
          <h2 id={titleId}>{photo.title}</h2>
          {photo.meta && <p className="photo-viewer-meta">{photo.meta}</p>}
        </div>
        <div className="actions photo-viewer-actions">{photo.actions}</div>
        {photo.details && photo.details !== photo.title && <div className="photo-viewer-details"><h3>Full prompt</h3><p>{photo.details}</p></div>}
      </div>
    </div>}
  </dialog>;
}
