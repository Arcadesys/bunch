import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOwnerId } from "@/server/auth";
import { isAuth0Configured } from "@/lib/auth0";
import { repository } from "@/server/repository";
import { AppNavigation } from "../app-navigation";
import { ProfileGallery } from "./profile-gallery";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile photos — Bunch",
  description: "Owner-authorized private profile photos.",
  robots: { index: false, follow: false },
};

export default async function PrivateGalleryPage() {
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    if (isAuth0Configured()) redirect("/auth/login?returnTo=%2Fgallery");
    return (
      <main className="app-page">
        <AppNavigation current="PHOTOS" />
        <div className="app-page-body">
          <h1>Profile photos</h1>
          <p className="notice" role="status">Sign-in is unavailable. Private photos cannot be loaded in this build.</p>
        </div>
      </main>
    );
  }
  const profiles = await repository.listProfiles(ownerId);

  return (
    <main className="app-page">
      <AppNavigation current="PHOTOS" />
      <ProfileGallery profiles={profiles} />
    </main>
  );
}
