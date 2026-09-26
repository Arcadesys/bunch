import type { Metadata } from "next";
import Link from "next/link";
import { AppNavigation } from "@/app/app-navigation";
import { GeneratedGallery } from "./generated-gallery";
import { PeopleToolsNav } from "@/app/people-tools-nav";

export const metadata: Metadata = {
  title: "Photo gallery — Bunch",
  description: "Your private generated images and group photos.",
  robots: { index: false, follow: false },
};

export default function GeneratedGalleryPage() {
  return <main className="shell gallery-shell">
    <AppNavigation current="GALLERY" />
    <PeopleToolsNav current="gallery" />
    <header className="album-header">
      <div><h1>Photo gallery</h1><p>Everything you&apos;ve made, newest first. Only you can see these.</p></div>
      <Link className="button" href="/images">Make an image</Link>
    </header>
    <GeneratedGallery />
  </main>;
}
