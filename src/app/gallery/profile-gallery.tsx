"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AlterProfile, PrivateImage } from "@/domain/types";
import { ListDetail, useListSelection, initials, type ListRow } from "@/app/list-detail";
import { DeleteImageButton } from "./delete-image-button";
import "./gallery.css";

function imageUrl(imageId: string) {
  return `/api/system/gallery-images/${encodeURIComponent(imageId)}`;
}

// UTC keeps the server render and the browser render identical.
const addedOn = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** Profile picture first, then newest uploads. */
function ordered(profile: AlterProfile, deleted: Set<string>): PrivateImage[] {
  return profile.images
    .filter(image => !deleted.has(image.id))
    .sort((a, b) => Number(b.id === profile.profilePicture?.id) - Number(a.id === profile.profilePicture?.id) || b.createdAt.localeCompare(a.createdAt));
}

export function ProfileGallery({ profiles }: { profiles: AlterProfile[] }) {
  const router = useRouter();
  // Deleted pictures disappear at once; the server refresh then confirms the album.
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());

  const people = useMemo(() => profiles
    .map(profile => ({ profile, images: ordered(profile, deleted) }))
    .filter(entry => entry.images.length > 0), [profiles, deleted]);
  const photoCount = people.reduce((count, entry) => count + entry.images.length, 0);

  const rows: ListRow[] = useMemo(() => people.map(({ profile, images }) => ({
    id: profile.id,
    avatar: { src: imageUrl(images[0].id), initials: initials(profile.name) },
    title: profile.name,
    meta: `${images.length} ${images.length === 1 ? "picture" : "pictures"}`,
  })), [people]);

  const ids = useMemo(() => rows.map(row => row.id), [rows]);
  const [selectedId, select] = useListSelection(ids);
  const current = people.find(entry => entry.profile.id === selectedId);

  const listStatus = photoCount === 0
    ? <div className="ld-intro gallery-empty"><h2>No photos yet</h2><p>Add pictures to a profile and they’ll gather here, one album per person.</p><Link className="button" href="/profiles">Add photos in Profiles</Link></div>
    : <p className="ld-intro" role="status">{photoCount} photo{photoCount === 1 ? "" : "s"} of {people.length} {people.length === 1 ? "person" : "people"}.</p>;

  return <ListDetail
    title="Profile photos"
    count={photoCount ? `${photoCount} ${photoCount === 1 ? "picture" : "pictures"}` : undefined}
    intro={<p>Every picture of every person, in one place. Only you can see these. <Link href="/profiles">Manage profiles</Link></p>}
    rows={rows}
    selectedId={current ? selectedId : null}
    onSelect={select}
    listStatus={listStatus}
    detailLabel="Album">
    {current ? <article className="detail-card" aria-labelledby={`album-${current.profile.id}`}>
      <h2 id={`album-${current.profile.id}`}>{current.profile.name}</h2>
      <p className="detail-eyebrow">{current.images.length} {current.images.length === 1 ? "photo" : "photos"}</p>
      <div className="detail-actions"><Link className="button button-secondary" href={`/profiles?id=${encodeURIComponent(current.profile.id)}`}>Manage {current.profile.name}’s profile</Link></div>
      <ul className="profile-photos-grid" aria-label={`Photos of ${current.profile.name}`}>
        {current.images.map(image => {
          const isProfilePicture = image.id === current.profile.profilePicture?.id;
          const date = image.createdAt ? addedOn.format(new Date(image.createdAt)) : undefined;
          return <li key={image.id} className="profile-photo-item">
            <div className="profile-photo-image-wrapper">
              {/* Private images load through the owner's session, never the public optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(image.id)} alt={isProfilePicture ? `${current.profile.name}’s profile picture` : `Photo of ${current.profile.name}`} loading="lazy" />
            </div>
            <p className="profile-photo-caption"><strong>{isProfilePicture ? "★ Profile picture" : date ? `Added ${date}` : "Photo"}</strong>{isProfilePicture && date ? <span>Added {date}</span> : null}</p>
            <div className="profile-photo-actions">
              <a className="button" href={imageUrl(image.id)} download={`${current.profile.name}-${image.id}`}>Download</a>
              <Link className="button button-secondary" href={`/images?repairKind=private&repairId=${image.id}`}>Repair this image</Link>
              <DeleteImageButton
                url={`/api/v1/account/images/${encodeURIComponent(image.id)}`}
                label={`${isProfilePicture ? "profile picture" : "photo"} of ${current.profile.name}`}
                onDeleted={() => {
                  setDeleted(previous => new Set([...previous, image.id]));
                  router.refresh();
                }}
              />
            </div>
          </li>;
        })}
      </ul>
    </article> : null}
  </ListDetail>;
}
