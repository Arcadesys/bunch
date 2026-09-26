"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AlterProfile } from "@/domain/types";
import type { AlterView } from "@/domain/contracts";
import { initials } from "../list-detail";
import "./profiles-page.css";

type ProfileDetailProps = {
  profile: AlterProfile;
  appearance: Pick<AlterView, "appearanceNotes" | "appearanceReferenceImageIds" | "version"> | undefined;
  onLoadAppearance: (profile: AlterProfile) => void;
  onSaveAppearance: (profile: AlterProfile) => void;
  onUpdateAppearance: (profileId: string, updates: Partial<Pick<AlterView, "appearanceNotes" | "appearanceReferenceImageIds">>) => void;
  onStartEdit: () => void;
  onSaveProfile: (event: FormEvent<HTMLFormElement>, profileId: string) => void;
  onChooseProfilePicture: (profile: AlterProfile, imageId: string) => void;
  onUploadImage: (event: FormEvent<HTMLFormElement>) => void;
  editing: boolean;
  onCancelEdit: () => void;
  saveInFlight: boolean;
  editingVersion: number | undefined;
  notice: string;
  presenceBadge?: { label: string; tone: "host" | "also" };
  privateImageUrl: (storageKey: string) => string;
};

type TabType = "about" | "pictures" | "appearance";

export function ProfileDetail({
  profile,
  appearance,
  onLoadAppearance,
  onSaveAppearance,
  onUpdateAppearance,
  onStartEdit,
  onSaveProfile,
  onChooseProfilePicture,
  onUploadImage,
  editing,
  onCancelEdit,
  saveInFlight,
  editingVersion,
  notice,
  presenceBadge,
  privateImageUrl,
}: ProfileDetailProps) {
  const [activeTab, setActiveTab] = useState<TabType>("about");
  const tabsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTab === "appearance" && !appearance) {
      onLoadAppearance(profile);
    }
  }, [activeTab, appearance, profile, onLoadAppearance]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const tabs = tabsRef.current?.querySelectorAll('[role="tab"]');
    if (!tabs) return;

    const currentIndex = Array.from(tabs).findIndex(
      (tab) => (tab as HTMLElement).getAttribute("aria-selected") === "true"
    );

    let newIndex = currentIndex;

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      newIndex = (currentIndex + 1) % tabs.length;
    }

    if (newIndex !== currentIndex) {
      const newTab = tabs[newIndex] as HTMLElement;
      newTab.focus();
      const tabName = newTab.getAttribute("aria-controls")?.replace("panel-", "") as TabType;
      setActiveTab(tabName);
    }
  };

  const profileForm = () => (
    <form key={profile.id} onSubmit={(event) => onSaveProfile(event, profile.id)} className="form-stack">
      <label>Name<input required name="name" maxLength={120} defaultValue={profile?.name || ""} /></label>
      <label>Self-described gender <span className="optional">optional</span><input name="gender" maxLength={120} defaultValue={profile?.selfDescribedGender || ""} /></label>
      <label>Description <span className="optional">optional</span><textarea name="description" maxLength={1000} rows={3} defaultValue={profile?.description || ""} /></label>
      <fieldset className="form-stack visual-identity"><legend>Visual identity</legend>
        <p>Saved identity for image prompts. Leave unknown details empty.</p>
        <label>Species<input name="species" maxLength={500} defaultValue={profile?.species || ""} /></label>
        <label>Visual description<textarea name="visualDescription" maxLength={1000} rows={3} defaultValue={profile?.visualDescription || ""} /></label>
        <label>Presentation<input name="presentation" maxLength={500} defaultValue={profile?.presentation || ""} /></label>
        <label>Pronouns<input name="pronouns" maxLength={500} defaultValue={profile?.pronouns || ""} /></label>
        <label>Signature traits — one per line<textarea name="signatureTraits" rows={3} defaultValue={profile?.signatureTraits?.join("\n") || ""} /></label>
        <label>Style tags — one per line<textarea name="styleTags" rows={3} defaultValue={profile?.styleTags?.join("\n") || ""} /></label>
        <label>Keep unchanged — one per line<textarea name="imageDoNotChange" rows={3} defaultValue={profile?.imageDoNotChange?.join("\n") || ""} /></label>
      </fieldset>
      <div className="actions"><button className="button" type="submit" disabled={saveInFlight}>Save profile changes</button><button className="button button-secondary" type="button" onClick={onCancelEdit} disabled={saveInFlight}>Cancel editing</button></div>
    </form>
  );

  const metaLine = useMemo(() => {
    const parts = [];
    if (profile.selfDescribedGender) parts.push(profile.selfDescribedGender);
    if (profile.pronouns) parts.push(profile.pronouns);
    if (profile.species) parts.push(profile.species);
    return parts.join(" · ") || "No details yet";
  }, [profile]);

  return (
    <article className="detail-card profiles-detail-card">
      {/* Header with picture and name */}
      <div className="profiles-detail-header">
        <div className="profiles-detail-picture">
          {profile.profilePicture ? (
            <img
              src={privateImageUrl(profile.profilePicture.storageKey)}
              alt={`Profile picture for ${profile.name}`}
              loading="lazy"
            />
          ) : (
            <span className="profiles-initials">{initials(profile.name)}</span>
          )}
        </div>
        <div>
          <h2>{profile.name}</h2>
          <p className="detail-eyebrow">{metaLine}</p>
          {presenceBadge && (
            <span className="ld-badge" data-tone={presenceBadge.tone}>
              {presenceBadge.label}
            </span>
          )}
        </div>
        {!editing && (
          <button type="button" className="button" onClick={onStartEdit}>
            Edit
          </button>
        )}
      </div>

      {/* Edit mode notice */}
      {editing && (
        <p className="profiles-edit-notice">
          Editing {profile.name}. Nothing is saved until you press Save.
        </p>
      )}

      {/* Tabs */}
      <div
        className="profiles-tablist"
        role="tablist"
        ref={tabsRef}
        onKeyDown={handleKeyDown}
      >
        {["about", "pictures", "appearance"].map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab ? "true" : "false"}
            aria-controls={`panel-${tab}`}
            onClick={() => setActiveTab(tab as TabType)}
          >
            {tab === "about" && "About"}
            {tab === "pictures" && "Pictures"}
            {tab === "appearance" && "Appearance"}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      {activeTab === "about" && !editing && (
        <div id="panel-about" role="tabpanel">
          {profile.description && <p>{profile.description}</p>}
          <dl className="detail-facts">
            {profile.species && (
              <div>
                <dt>Species</dt>
                <dd>{profile.species}</dd>
              </div>
            )}
            {profile.presentation && (
              <div>
                <dt>Presentation</dt>
                <dd>{profile.presentation}</dd>
              </div>
            )}
            {profile.pronouns && (
              <div>
                <dt>Pronouns</dt>
                <dd>{profile.pronouns}</dd>
              </div>
            )}
            {profile.selfDescribedGender && (
              <div>
                <dt>Self-described gender</dt>
                <dd>{profile.selfDescribedGender}</dd>
              </div>
            )}
            {profile.visualDescription && (
              <div>
                <dt>Visual description</dt>
                <dd>{profile.visualDescription}</dd>
              </div>
            )}
          </dl>
          {profile.signatureTraits && profile.signatureTraits.length > 0 && (
            <div className="profiles-tag-group">
              <span>Signature traits</span>
              <div className="profiles-chips">
                {profile.signatureTraits.map((trait) => (
                  <span key={trait} className="chip">{trait}</span>
                ))}
              </div>
            </div>
          )}
          {profile.styleTags && profile.styleTags.length > 0 && (
            <div className="profiles-tag-group">
              <span>Style tags</span>
              <div className="profiles-chips">
                {profile.styleTags.map((tag) => (
                  <span key={tag} className="chip">{tag}</span>
                ))}
              </div>
            </div>
          )}
          {profile.imageDoNotChange && profile.imageDoNotChange.length > 0 && (
            <div className="profiles-tag-group">
              <span>Keep unchanged</span>
              <div className="profiles-chips">
                {profile.imageDoNotChange.map((item) => (
                  <span key={item} className="chip">{item}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "about" && editing && (
        <div id="panel-about" role="tabpanel">
          {profileForm()}
        </div>
      )}

      {activeTab === "pictures" && (
        <div id="panel-pictures" role="tabpanel" className="profiles-pictures">
          <p>Private pictures. Earlier pictures stay available here.</p>
          {profile.images.length > 0 && (
            <div className="profiles-image-grid">
              {profile.images.map((image, index) => (
                <figure key={image.id} className="profiles-image-card">
                  <div className="profiles-image-container">
                    <img
                      src={privateImageUrl(image.storageKey)}
                      alt={`Private picture ${index + 1} for ${profile.name}`}
                      loading="lazy"
                    />
                    {image.isProfilePicture && (
                      <span className="profiles-selected-label">
                        Selected as profile picture
                      </span>
                    )}
                  </div>
                  {!image.isProfilePicture && (
                    <figcaption>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => onChooseProfilePicture(profile, image.id)}
                      >
                        Use picture {index + 1} for {profile.name}
                      </button>
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          )}
          {profile.images.length === 0 && (
            <p>No pictures yet. Add one below.</p>
          )}
          <form onSubmit={onUploadImage} className="upload-form compact-upload">
            <input type="hidden" name="alterId" value={profile.id} />
            <input type="hidden" name="expectedVersion" value={profile.version} />
            <input type="hidden" name="setAsProfilePicture" value="true" />
            <label>Choose a new profile picture<input required name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label>
            <button className="button" type="submit" disabled={saveInFlight}>Change {profile.name}&apos;s profile picture</button>
          </form>
          <form onSubmit={onUploadImage} className="upload-form">
            <input type="hidden" name="alterId" value={profile.id} />
            <label>Add an image to {profile.name}&apos;s gallery<input required name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label>
            <button className="button button-secondary" type="submit" disabled={saveInFlight}>Store private image</button>
          </form>
        </div>
      )}

      {activeTab === "appearance" && appearance && (
        <div id="panel-appearance" role="tabpanel" className="profiles-appearance">
          <p>Choose visual references for Furry Image Studio. This does not change the profile picture, hosting, or fronting.</p>
          <label>Appearance notes <span className="optional">optional</span><textarea rows={3} maxLength={5000} value={appearance.appearanceNotes || ""} onChange={event => onUpdateAppearance(profile.id, { appearanceNotes: event.target.value })} /></label>
          {profile.images.length > 0 && (
            <>
              <span>References · {appearance.appearanceReferenceImageIds.length} selected</span>
              <div className="profiles-reference-buttons">
                {profile.images.map((image, index) => (
                  <button
                    key={`reference-${image.id}`}
                    type="button"
                    className="profiles-reference-button"
                    aria-pressed={appearance.appearanceReferenceImageIds.includes(image.id)}
                    onClick={() => {
                      const isSelected = appearance.appearanceReferenceImageIds.includes(image.id);
                      onUpdateAppearance(profile.id, {
                        appearanceReferenceImageIds: isSelected
                          ? appearance.appearanceReferenceImageIds.filter((id: string) => id !== image.id)
                          : [...appearance.appearanceReferenceImageIds, image.id]
                      });
                    }}
                    aria-label={`Use private picture ${index + 1} as an appearance reference`}
                  >
                    <img
                      src={privateImageUrl(image.storageKey)}
                      alt={`Private picture ${index + 1}`}
                      loading="lazy"
                    />
                    <span>{appearance.appearanceReferenceImageIds.includes(image.id) ? "✓" : ""}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {profile.images.length === 0 && (
            <p>Add a picture first to use it as a reference.</p>
          )}
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onSaveAppearance(profile)}
            disabled={saveInFlight}
          >
            Save appearance references
          </button>
        </div>
      )}

      {activeTab === "appearance" && !appearance && (
        <div id="panel-appearance" role="tabpanel">
          <p>Loading appearance settings…</p>
        </div>
      )}
    </article>
  );
}
