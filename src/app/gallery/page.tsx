import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { requireOwnerId } from "@/server/auth";
import { isAuth0Configured } from "@/lib/auth0";
import { repository } from "@/server/repository";
import { AppNavigation } from "../app-navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private photo gallery — DIDdy",
  description: "Owner-authorized private profile photos.",
  robots: { index: false, follow: false },
};

function imageUrl(imageId: string) {
  return `/api/system/gallery-images/${encodeURIComponent(imageId)}`;
}

export default async function PrivateGalleryPage() {
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    if (isAuth0Configured()) redirect("/auth/login?returnTo=%2Fgallery");
    return (
      <main className="shell gallery-shell">
        <AppNavigation current="GALLERY" />
        <h1>Private photo gallery</h1>
        <p className="notice" role="status">Sign-in is unavailable. Private photos cannot be loaded in this build.</p>
      </main>
    );
  }
  const profiles = await repository.listProfiles(ownerId);
  const photoCount = profiles.reduce((count, profile) => count + profile.images.length, 0);

  return (
    <main className="shell gallery-shell">
      <AppNavigation current="GALLERY" />
      <header className="site-header">
        <div>
          <p className="eyebrow">DIDdy · private photos</p>
          <h1>Private photo gallery</h1>
        </div>
        <div className="header-actions"><Link className="button button-secondary" href="/profiles">Manage profiles and pictures</Link></div>
      </header>

      <p className="notice" role="status">
        {photoCount === 0
          ? "No private photos are stored yet."
          : `${photoCount} private photo${photoCount === 1 ? "" : "s"} in your gallery.`}
      </p>

      {profiles.filter((profile) => profile.images.length > 0).map((profile) => (
        <section className="gallery-section" key={profile.id} aria-labelledby={`profile-${profile.id}`}>
          <h2 id={`profile-${profile.id}`}>{profile.name}</h2>
          <p className="small">{profile.images.length} private photo{profile.images.length === 1 ? "" : "s"}</p>
          {profile.profilePicture ? <div className="gallery-profile-picture"><h3>Profile picture</h3><p className="selected-state">Selected as current profile picture</p><Image src={imageUrl(profile.profilePicture.id)} alt={`Profile picture for ${profile.name}`} width={540} height={540} unoptimized /></div> : <p className="empty-picture">No profile picture selected.</p>}
          <h3>Private picture history</h3>
          <div className="gallery-grid">
            {profile.images.map((image, index) => (
              <figure className="gallery-card" key={image.id}>
                <Image src={imageUrl(image.id)} alt={`Private picture ${index + 1} for ${profile.name}`} width={480} height={480} unoptimized />
                <figcaption>{image.isProfilePicture ? "Selected as profile picture" : `Private picture ${index + 1}`}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
