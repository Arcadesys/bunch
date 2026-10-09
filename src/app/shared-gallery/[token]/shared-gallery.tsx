"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type ImageRecord = {
  id: string;
  contentType: string;
  role: "profile" | "image";
  order: number;
};
type Alter = {
  id: string;
  name: string;
  images: ImageRecord[];
};
type Gallery = {
  currentFronting?: { people: Array<{ id: string; name: string }>; checkedAt: string };
  alters: Alter[];
  generalImages?: ImageRecord[];
};

function imageUrl(token: string, imageId: string) {
  return `/api/public/gallery/${encodeURIComponent(token)}/images/${encodeURIComponent(imageId)}`;
}

function GalleryImage({ token, image, alt, onOpen }: { token: string; image: { id: string }; alt: string; onOpen: (button: HTMLButtonElement) => void }) {
  return <button className="shared-gallery-image-button" type="button" onClick={(event) => onOpen(event.currentTarget)} aria-label={`Open larger view: ${alt}`}>
    {/* Public image responses are intentionally the only media source rendered here. */}
    <Image src={imageUrl(token, image.id)} alt={alt} width={720} height={720} sizes="(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 520px" loading="lazy" decoding="async" unoptimized />
    <span>Open larger view</span>
  </button>;
}

export function SharedGallery({ token }: { token: string }) {
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [started, setStarted] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [openImage, setOpenImage] = useState<{ id: string; alt: string } | null>(null);
  const [status, setStatus] = useState("Loading this shared gallery…");
  const dialog = useRef<HTMLDialogElement>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let live = true;
    let pending = false;
    let queued = false;
    let controller: AbortController | undefined;
    async function refresh() {
      if (!live || document.visibilityState !== "visible") return;
      if (pending) {
        queued = true;
        return;
      }
      pending = true;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 10000);
      try {
        const response = await fetch(`/api/public/gallery/${encodeURIComponent(token)}`, { cache: "no-store", signal: requestController.signal });
        if (!response.ok) throw new Error("unavailable");
        const data = await response.json() as Gallery;
        if (!live || requestController.signal.aborted) return;
        setGallery({ ...data, generalImages: data.generalImages ?? [] });
        setStatus("");
      } catch {
        if (live && !requestController.signal.aborted) {
          setGallery(null);
          setOpenImage(null);
          setStatus("This shared gallery is unavailable.");
        }
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (controller === requestController) controller = undefined;
        if (queued) {
          queued = false;
          if (document.visibilityState === "visible") void refresh();
        }
      }
    }
    const requestRefresh = () => {
      if (!live || document.visibilityState !== "visible") return;
      void refresh();
    };
    refreshRef.current = requestRefresh;
    void requestRefresh();
    const interval = setInterval(requestRefresh, 30000);
    const onFocus = requestRefresh;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") requestRefresh();
      else queued = false;
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => { live = false; controller?.abort(); clearInterval(interval); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisibilityChange); refreshRef.current = null; };
  }, [token]);

  useEffect(() => {
    if (openImage) dialog.current?.showModal();
  }, [openImage]);
  function closeImage() {
    dialog.current?.close();
  }
  function handleDialogClose() {
    setOpenImage(null);
    window.requestAnimationFrame(() => lastTrigger.current?.focus());
  }

  const selected = gallery?.alters[selectedIndex] ?? gallery?.alters[0];
  return <main className="shell shared-gallery-shell">
    <header className="shared-gallery-intro">
      <p className="eyebrow">Bunch · shared photo gallery</p>
      <h1>A shared, read-only photo gallery</h1>
      <p>This gallery was shared with you by its owner. It does not require a Bunch account or sign-in.</p>
      {status && <p className="notice" role="status">{status}</p>}
    </header>
    <button className="button button-secondary" type="button" onClick={() => refreshRef.current?.()}>Refresh shared gallery</button>
    {gallery?.currentFronting && <section className="shared-gallery-welcome" aria-labelledby="current-fronting-heading" aria-live="polite">
      <h2 id="current-fronting-heading">Currently recorded as fronting</h2>
      {gallery.currentFronting.people.length ? <ul>{gallery.currentFronting.people.map(person => <li key={person.id}>{person.name}</li>)}</ul> : <p>No active fronting records are available to share. This does not mean nobody is fronting.</p>}
      <p>Based on the owner’s recorded updates. Hosting is separate. Checks for updates every 30 seconds.</p>
      <p>Last checked: {new Date(gallery.currentFronting.checkedAt).toLocaleTimeString()}</p>
    </section>}
    {gallery && !started && <section className="shared-gallery-welcome" aria-labelledby="who-heading">
      <h2 id="who-heading">Who’s in this gallery</h2>
      {gallery.alters.length ? <ul>{gallery.alters.map((alter) => <li key={alter.id}>{alter.name}</li>)}</ul> : <p>No alter photos are available in this gallery.</p>}
      <button className="button" type="button" onClick={() => setStarted(true)}>Continue to the gallery</button>
    </section>}
    {gallery && started && <>
      {gallery.alters.length > 0 && <nav className="shared-gallery-nav" aria-label="People in this gallery">
        <p>Choose a person</p>
        <div>{gallery.alters.map((alter, index) => <button type="button" key={alter.id} className={index === selectedIndex ? "button" : "button button-secondary"} aria-current={index === selectedIndex ? "page" : undefined} onClick={() => setSelectedIndex(index)}>{alter.name}</button>)}</div>
      </nav>}
      {selected && <section className="shared-gallery-person" aria-labelledby="selected-person">
        <h2 id="selected-person">{selected.name}</h2>
        {selected.images.filter((image) => image.role === "profile").map((image) => <section key={image.id} aria-labelledby="profile-picture-heading">
          <h3 id="profile-picture-heading">Profile picture</h3>
          <GalleryImage token={token} image={image} alt={`Profile picture for ${selected.name}`} onOpen={(button) => { lastTrigger.current = button; setOpenImage({ id: image.id, alt: `Profile picture for ${selected.name}` }); }} />
        </section>)}
        <h3>All pictures</h3>
        {(() => {
          const additionalImages = selected.images.filter((image) => image.role !== "profile");
          return additionalImages.length ? <div className="shared-gallery-grid">{[...additionalImages].sort((a, b) => a.order - b.order).map((image, index) => <GalleryImage key={image.id} token={token} image={image} alt={`Picture ${index + 1} for ${selected.name}`} onOpen={(button) => { lastTrigger.current = button; setOpenImage({ id: image.id, alt: `Picture ${index + 1} for ${selected.name}` }); }} />)}</div> : <p className="empty-picture">No additional gallery pictures were shared for {selected.name}.</p>;
        })()}
      </section>}
      {(gallery.generalImages?.length ?? 0) > 0 && <section className="shared-gallery-person" aria-labelledby="general-gallery-heading">
        <h2 id="general-gallery-heading">General gallery</h2>
        <div className="shared-gallery-grid">{[...gallery.generalImages!].sort((a, b) => a.order - b.order).map((image, index) => <GalleryImage key={image.id} token={token} image={image} alt={`General gallery picture ${index + 1}`} onOpen={(button) => { lastTrigger.current = button; setOpenImage({ id: image.id, alt: `General gallery picture ${index + 1}` }); }} />)}</div>
      </section>}
    </>}
    <dialog ref={dialog} className="shared-gallery-dialog" aria-label={openImage?.alt ?? "Larger picture view"} onClose={handleDialogClose}>
      {openImage && <><Image src={imageUrl(token, openImage.id)} alt={openImage.alt} width={1200} height={1200} loading="eager" decoding="async" unoptimized /><form method="dialog"><button className="button" type="button" onClick={closeImage}>Close larger view</button></form></>}
    </dialog>
  </main>;
}
