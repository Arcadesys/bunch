"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AlterProfile, PrivateImage } from "@/domain/types";
import { DeleteImageButton } from "./delete-image-button";
import { PhotoAlbum, type AlbumPhoto } from "./photo-album";

function imageUrl(imageId: string) {
  return `/api/system/gallery-images/${encodeURIComponent(imageId)}`;
}

// UTC keeps the server render and the browser render identical.
const addedOn = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

function albumFor(profile: AlterProfile, onDeleted: () => void): AlbumPhoto[] {
  // Profile picture first, then newest uploads.
  const ordered = [...profile.images].sort((a, b) => Number(b.id === profile.profilePicture?.id) - Number(a.id === profile.profilePicture?.id) || b.createdAt.localeCompare(a.createdAt));
  return ordered.map((image: PrivateImage) => {
    const isProfilePicture = image.id === profile.profilePicture?.id;
    const title = isProfilePicture ? `${profile.name}'s profile picture` : `Photo of ${profile.name}`;
    const date = image.createdAt ? addedOn.format(new Date(image.createdAt)) : undefined;
    return {
      key: image.id,
      src: imageUrl(image.id),
      alt: title,
      title: isProfilePicture ? "★ Profile picture" : date ? `Added ${date}` : "Photo",
      meta: isProfilePicture && date ? `Added ${date}` : undefined,
      actions: <>
        <a className="button" href={imageUrl(image.id)} download={`${profile.name}-${image.id}`}>Download</a>
        <Link className="button button-secondary" href={`/images?repairKind=private&repairId=${image.id}`}>Repair this image</Link>
        <DeleteImageButton url={`/api/v1/account/images/${encodeURIComponent(image.id)}`} label={`${isProfilePicture ? "profile picture" : "photo"} of ${profile.name}`} onDeleted={onDeleted} />
      </>,
    };
  });
}

export function ProfileGallery({ profiles }: { profiles: AlterProfile[] }) {
  const router = useRouter();
  const people = profiles.filter((profile) => profile.images.length > 0);
  const photoCount = people.reduce((count, profile) => count + profile.images.length, 0);
  if (photoCount === 0) return <div className="panel"><h2>No photos yet</h2><p>Add pictures to a profile and they&apos;ll gather here, one album per person.</p><Link className="button" href="/profiles">Add photos in Profiles</Link></div>;
  return <>
    <p className="album-status" role="status">{photoCount} photo{photoCount === 1 ? "" : "s"} of {people.length} {people.length === 1 ? "person" : "people"}.</p>
    {people.map((profile) => {
      const avatar = profile.profilePicture ?? profile.images[0];
      return <section className="album-person" key={profile.id} aria-labelledby={`album-${profile.id}`}>
        <header className="album-person-header">
          <Image className="album-avatar" src={imageUrl(avatar.id)} alt="" width={96} height={96} unoptimized />
          <div>
            <h2 id={`album-${profile.id}`}>{profile.name}</h2>
            <p>{profile.images.length} photo{profile.images.length === 1 ? "" : "s"}</p>
          </div>
        </header>
        <PhotoAlbum photos={albumFor(profile, () => router.refresh())} label={`Photos of ${profile.name}`} />
      </section>;
    })}
  </>;
}
