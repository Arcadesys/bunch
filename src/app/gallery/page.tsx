import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { requireOwnerId } from "@/server/auth";
import { isAuth0Configured } from "@/lib/auth0";
import { repository } from "@/server/repository";
import { getSystemService } from "@/server/system-service";
import { AppNavigation } from "../app-navigation";
import { PeopleToolsNav } from "../people-tools-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My gallery — Bunch",
  description: "Your private profile photos, with a choice of other galleries.",
  robots: { index: false, follow: false },
};

function imageUrl(imageId: string) {
  return `/api/system/gallery-images/${encodeURIComponent(imageId)}`;
}

export default async function PrivateGalleryPage({ searchParams }: { searchParams: Promise<{ profileId?: string | string[]; view?: string | string[] }> }) {
  const query = await searchParams;
  const requestedProfileId = Array.isArray(query.profileId) ? query.profileId[0] : query.profileId;
  const view = Array.isArray(query.view) ? query.view[0] : query.view;
  const showingOthers = view === "others";
  let ownerId: string;
  try {
    ownerId = await requireOwnerId();
  } catch {
    if (isAuth0Configured()) redirect("/auth/login?returnTo=%2Fgallery");
    return (
      <main className="shell gallery-shell">
        <AppNavigation current="GALLERY" />
        <PeopleToolsNav current={showingOthers ? "other-galleries" : "profile-gallery"} />
        <h1>{showingOthers ? "Other galleries" : "My gallery"}</h1>
        <p className="notice" role="status">Sign-in is unavailable. Private photos cannot be loaded in this build.</p>
      </main>
    );
  }
  const [profiles, currentFront] = await Promise.all([
    repository.listProfiles(ownerId),
    getSystemService().getCurrentFront(ownerId),
  ]);
  const ownProfileId = currentFront?.alterId;
  const selectedProfile = profiles.find((profile) => profile.id === requestedProfileId)
    ?? profiles.find((profile) => profile.id === ownProfileId);
  const otherProfiles = profiles.filter((profile) => profile.id !== ownProfileId);
  const currentPhotoTab = showingOthers || (requestedProfileId && requestedProfileId !== ownProfileId) ? "other-galleries" : "profile-gallery";

  return (
    <main className="shell gallery-shell">
      <AppNavigation current="GALLERY" />
      <PeopleToolsNav current={currentPhotoTab} />
      <header className="site-header">
        <div>
          <p className="eyebrow">Bunch · private photos</p>
          <h1>{showingOthers ? "Other galleries" : selectedProfile?.id === ownProfileId ? "My gallery" : selectedProfile ? `${selectedProfile.name}’s gallery` : "My gallery"}</h1>
          <p>{showingOthers ? "Choose a person to open their private profile photos." : selectedProfile?.id === ownProfileId ? "Your profile photos first. Choose another gallery whenever you want." : selectedProfile ? `Viewing ${selectedProfile.name}’s private profile photos.` : "Choose a profile gallery to get started."}</p>
        </div>
        <div className="header-actions"><Link className="button" href="/gallery/generated">Generated photos</Link><Link className="button button-secondary" href="/profiles">Manage profiles and pictures</Link></div>
      </header>

      {!showingOthers && profiles.length > 0 ? <form className="gallery-profile-picker" action="/gallery" method="get">
        <label htmlFor="gallery-profile">Choose a profile gallery</label>
        <select id="gallery-profile" name="profileId" defaultValue={selectedProfile?.id ?? ""} required>
          {!selectedProfile ? <option value="">Choose a person</option> : null}
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.id === ownProfileId ? `${profile.name} (my gallery)` : profile.name}</option>)}
        </select>
        <button className="button button-secondary" type="submit">View gallery</button>
      </form> : null}

      {showingOthers ? <>
        <p><Link className="button button-secondary" href="/gallery">Back to My gallery</Link></p>
        <p className="notice" role="status">{otherProfiles.length ? `${otherProfiles.length} other profile${otherProfiles.length === 1 ? "" : "s"} available.` : "There are no other profile galleries yet."}</p>
        <div className="gallery-grid">
          {otherProfiles.map((profile) => <section className="gallery-card" key={profile.id}>
            <h2>{profile.name}</h2>
            <p>{profile.images.length} private photo{profile.images.length === 1 ? "" : "s"}</p>
            <Link className="button button-secondary" href={`/gallery?profileId=${encodeURIComponent(profile.id)}`}>View {profile.name}’s gallery</Link>
          </section>)}
        </div>
      </> : selectedProfile ? <section className="gallery-section" aria-labelledby={`profile-${selectedProfile.id}`}>
        <h2 id={`profile-${selectedProfile.id}`}>{selectedProfile.name}</h2>
        <p className="small">{selectedProfile.images.length} private photo{selectedProfile.images.length === 1 ? "" : "s"}</p>
        {selectedProfile.profilePicture ? <div className="gallery-profile-picture"><h3>Profile picture</h3><p className="selected-state">Selected as current profile picture</p><Image src={imageUrl(selectedProfile.profilePicture.id)} alt={`Profile picture for ${selectedProfile.name}`} width={540} height={540} sizes="(max-width: 600px) 100vw, 560px" loading="lazy" decoding="async" unoptimized /></div> : <p className="empty-picture">No profile picture selected.</p>}
        <h3>Private picture history</h3>
        {(() => {
          const historyImages = selectedProfile.images
            .map((image, index) => ({ image, index }))
            .filter(({ image }) => image.id !== selectedProfile.profilePicture?.id);
          return historyImages.length ? <div className="gallery-grid">
            {historyImages.map(({ image, index }) => (
              <figure className="gallery-card" key={image.id}>
                <Image src={imageUrl(image.id)} alt={`Private picture ${index + 1} for ${selectedProfile.name}`} width={480} height={480} sizes="(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 480px" loading="lazy" decoding="async" unoptimized />
                <figcaption>{image.isProfilePicture ? "Selected as profile picture" : `Private picture ${index + 1}`}</figcaption><Link className="button button-secondary" href={`/images?repairKind=private&repairId=${image.id}`}>Repair this image</Link>
              </figure>
            ))}
          </div> : <p className="empty-picture">No additional private pictures are stored.</p>;
        })()}
      </section> : <p className="notice" role="status">No current profile is recorded. Choose a person above to open a gallery.</p>}

    </main>
  );
}
