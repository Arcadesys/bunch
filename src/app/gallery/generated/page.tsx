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
  return <main className="app-page">
    <AppNavigation current="GALLERY" />
    <GeneratedGallery />
  </main>;
}
