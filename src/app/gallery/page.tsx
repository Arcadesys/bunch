import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOwnerId } from "@/server/auth";
import { isAuth0Configured } from "@/lib/auth0";
import { repository } from "@/server/repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private photo gallery — System",
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
        <h1>Private photo gallery</h1>
        <p className="notice" role="status">Sign-in is unavailable in this local build. Configure Auth0 to view private photos.</p>
      </main>
    );
  }
  const profiles = await repository.listProfiles(ownerId);
  const photoCount = profiles.reduce((count, profile) => count + profile.images.length, 0);

  return (
    <main className="shell gallery-shell">
      <header className="site-header">
        <div>
          <p className="eyebrow">System · authenticated browser fallback</p>
          <h1>Private photo gallery</h1>
        </div>
        <Link className="button button-secondary" href="/">Open full companion</Link>
      </header>

      <p className="notice" role="status">
        {photoCount === 0
          ? "No private photos are stored yet."
          : `${photoCount} private photo${photoCount === 1 ? "" : "s"} available in this signed-in browser.`}
      </p>

      {profiles.filter((profile) => profile.images.length > 0).map((profile) => (
        <section className="gallery-section" key={profile.id} aria-labelledby={`profile-${profile.id}`}>
          <h2 id={`profile-${profile.id}`}>{profile.name}</h2>
          <p className="small">{profile.images.length} private photo{profile.images.length === 1 ? "" : "s"}</p>
          <div className="gallery-grid">
            {profile.images.map((image, index) => (
              <figure className="gallery-card" key={image.id}>
                <img src={imageUrl(image.id)} alt={`Private photo ${index + 1} of ${profile.name}`} />
                <figcaption>Photo {index + 1}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
