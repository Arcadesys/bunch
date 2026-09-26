"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { AlterProfile } from "@/domain/types";
import { ListDetail, useListSelection, initials, type ListRow } from "@/app/list-detail";
import { DeleteImageButton } from "./delete-image-button";
import "./gallery.css";

function imageUrl(imageId: string) {
  return `/api/system/gallery-images/${encodeURIComponent(imageId)}`;
}

// UTC keeps the server render and the browser render identical.
const addedOn = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function ProfileGallery({ profiles }: { profiles: AlterProfile[] }) {
  const router = useRouter();
  const [deletedImages, setDeletedImages] = useState<Set<string>>(new Set());

  // Filter profiles with images that haven't been completely deleted
  const people = useMemo(() => profiles.filter((profile) =>
    profile.images.some(img => !deletedImages.has(img.id))
  ), [profiles, deletedImages]);

  const photoCount = useMemo(() =>
    people.reduce((count, profile) =>
      count + profile.images.filter(img => !deletedImages.has(img.id)).length, 0
    ), [people, deletedImages]
  );

  const rows: ListRow[] = useMemo(() => people.map(profile => {
    const avatar = profile.profilePicture ?? profile.images.find(img => !deletedImages.has(img.id));
    const pictureCount = profile.images.filter(img => !deletedImages.has(img.id)).length;
    return {
      id: profile.id,
      avatar: {
        src: avatar ? imageUrl(avatar.id) : null,
        initials: initials(profile.name),
      },
      title: profile.name,
      meta: `${pictureCount} picture${pictureCount === 1 ? "" : "s"}`,
    };
  }), [people, deletedImages]);

  const ids = useMemo(() => rows.map(row => row.id), [rows]);
  const [selectedId, select] = useListSelection(ids);
  const current = people.find(p => p.id === selectedId);

  const listStatus = !people.length && photoCount === 0
    ? <div className="ld-intro"><p>No photos yet. Add pictures to a profile and they&apos;ll gather here, one album per person.</p><Link className="button" href="/profiles">Add photos in Profiles</Link></div>
    : null;

  return <ListDetail
    title="Profile photos"
    count={photoCount ? `${photoCount} picture${photoCount === 1 ? "" : "s"}` : undefined}
    rows={rows}
    selectedId={selectedId}
    onSelect={select}
    listStatus={listStatus}>
    {current ? <article className="detail-card" id={`profile-${selectedId}`}>
      <h2>{current.name}</h2>
      <span className="detail-eyebrow">{current.images.filter(img => !deletedImages.has(img.id)).length} picture{current.images.filter(img => !deletedImages.has(img.id)).length === 1 ? "" : "s"}</span>
      <Link className="button button-secondary" href={`/profiles?id=${current.id}`}>Manage profile →</Link>
      <p>Every picture of every person, in one place. Only you can see these.</p>

      {current.images.filter(img => !deletedImages.has(img.id)).length > 0 ? (
        <div className="profile-photos-grid">
          {current.images.filter(img => !deletedImages.has(img.id)).map((image) => {
            const isProfilePicture = image.id === current.profilePicture?.id;
            return (
              <figure key={image.id} className="profile-photo-item">
                <div className="profile-photo-image-wrapper">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl(image.id)} alt={`Photo of ${current.name}`} />
                  {isProfilePicture && <span className="profile-picture-label">Profile picture</span>}
                </div>
                <div className="profile-photo-actions">
                  <a className="button" href={imageUrl(image.id)} download={`${current.name}-${image.id}`}>Download</a>
                  <Link className="button button-secondary" href={`/images?repairKind=private&repairId=${image.id}`}>Repair</Link>
                  <DeleteImageButton
                    url={`/api/v1/account/images/${encodeURIComponent(image.id)}`}
                    label={`${isProfilePicture ? "profile picture" : "photo"} of ${current.name}`}
                    onDeleted={() => {
                      setDeletedImages(prev => new Set([...prev, image.id]));
                    }}
                  />
                </div>
              </figure>
            );
          })}
        </div>
      ) : (
        <p>No pictures stored for {current.name} yet.</p>
      )}
    </article> : null}
  </ListDetail>;
}
