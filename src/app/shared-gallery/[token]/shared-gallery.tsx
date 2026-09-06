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
  alters: Alter[];
  generalImages?: ImageRecord[];
};

function imageUrl(token: string, imageId: string) {
  return `/api/public/gallery/${encodeURIComponent(token)}/images/${encodeURIComponent(imageId)}`;
}

function GalleryImage({ token, image, alt, onOpen }: { token: string; image: { id: string }; alt: string; onOpen: () => void }) {
  return <button className="shared-gallery-image-button" type="button" onClick={onOpen} aria-label={`Open larger view: ${alt}`}>
    {/* Public image responses are intentionally the only media source rendered here. */}
    <Image src={imageUrl(token, image.id)} alt={alt} width={720} height={720} unoptimized />
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

  useEffect(() => {
    let live = true;
    void fetch(`/api/public/gallery/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        return response.json() as Promise<Gallery>;
      })
      .then((response) => {
        if (!live) return;
        const data = { ...response, generalImages: response.generalImages ?? [] };
        setGallery(data);
        setSelectedIndex(0);
        setStatus("");
      })
      .catch(() => live && setStatus("This shared gallery is unavailable."));
    return () => { live = false; };
  }, [token]);

  useEffect(() => {
    if (openImage) dialog.current?.showModal();
  }, [openImage]);
  function closeImage() {
    dialog.current?.close();
    setOpenImage(null);
  }

  const selected = gallery?.alters[selectedIndex] ?? gallery?.alters[0];
  return <main className="shell shared-gallery-shell">
    <header className="shared-gallery-intro">
      <p className="eyebrow">Bunch · shared photo gallery</p>
      <h1>A shared, read-only photo gallery</h1>
      <p>This gallery was shared with you by its owner. It does not require a Bunch account or sign-in.</p>
      {status && <p className="notice" role="status">{status}</p>}
    </header>
    {gallery && !started && <section className="shared-gallery-welcome" aria-labelledby="who-heading">
      <h2 id="who-heading">Who’s here</h2>
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
          <GalleryImage token={token} image={image} alt={`Profile picture for ${selected.name}`} onOpen={() => setOpenImage({ id: image.id, alt: `Profile picture for ${selected.name}` })} />
        </section>)}
        <h3>All pictures</h3>
        {selected.images.length ? <div className="shared-gallery-grid">{[...selected.images].sort((a, b) => a.order - b.order).map((image, index) => <GalleryImage key={image.id} token={token} image={image} alt={`Picture ${index + 1} for ${selected.name}`} onOpen={() => setOpenImage({ id: image.id, alt: `Picture ${index + 1} for ${selected.name}` })} />)}</div> : <p className="empty-picture">No gallery pictures were shared for {selected.name}.</p>}
      </section>}
      {(gallery.generalImages?.length ?? 0) > 0 && <section className="shared-gallery-person" aria-labelledby="general-gallery-heading">
        <h2 id="general-gallery-heading">General gallery</h2>
        <div className="shared-gallery-grid">{[...gallery.generalImages!].sort((a, b) => a.order - b.order).map((image, index) => <GalleryImage key={image.id} token={token} image={image} alt={`General gallery picture ${index + 1}`} onOpen={() => setOpenImage({ id: image.id, alt: `General gallery picture ${index + 1}` })} />)}</div>
      </section>}
    </>}
    <dialog ref={dialog} className="shared-gallery-dialog" aria-label={openImage?.alt ?? "Larger picture view"} onClose={() => setOpenImage(null)}>
      {openImage && <><Image src={imageUrl(token, openImage.id)} alt={openImage.alt} width={1200} height={1200} unoptimized /><form method="dialog"><button className="button" type="button" onClick={closeImage}>Close larger view</button></form></>}
    </dialog>
  </main>;
}
