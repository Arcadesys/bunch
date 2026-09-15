import type { Metadata } from "next";
import Link from "next/link";
import { AppNavigation } from "@/app/app-navigation";
import { GeneratedGallery } from "./generated-gallery";

export const metadata: Metadata = {
  title: "Photo gallery — Bunch",
  description: "Your private generated images and group photos.",
  robots: { index: false, follow: false },
};

export default function GeneratedGalleryPage() {
  return <main className="shell gallery-shell">
    <AppNavigation current="GALLERY" />
    <header className="site-header">
      <div><p className="eyebrow">Bunch · private photos</p><h1>Photo gallery</h1><p>Your generated images and group photos, newest first.</p></div>
      <div className="header-actions"><Link className="button" href="/images">Create an image</Link><Link className="button button-secondary" href="/group-photo">Create a group photo</Link><Link className="button button-secondary" href="/gallery">Profile photos</Link></div>
    </header>
    <GeneratedGallery />
  </main>;
}
