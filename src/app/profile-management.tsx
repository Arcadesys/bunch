"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AlterProfile } from "@/domain/types";
import type { AlterView } from "@/domain/contracts";
import { AppNavigation, PRESENCE_CHANGED_EVENT } from "./app-navigation";
import { ListDetail, useListSelection, initials } from "./list-detail";
import { ProfileDetail } from "./profiles/profile-detail";

type SystemState = { currentFront: unknown; profiles: AlterProfile[] };
type PresenceData = { hosting: { alterId: string } | null; fronting: { alterId: string }[] };

const demoHeaders = { "Content-Type": "application/json", "x-system-demo": "local" };

function privateImageUrl(storageKey: string) {
  return `/api/system/images/${storageKey.split("/").map(encodeURIComponent).join("/")}`;
}

async function systemRequest(method: "GET" | "POST", body?: unknown) {
  const response = await fetch("/api/system", {
    method,
    headers: method === "GET" ? { "x-system-demo": "local" } : demoHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Request failed.");
  return data;
}

export function ProfileManagement() {
  const [state, setState] = useState<SystemState>({ currentFront: null, profiles: [] });
  const [notice, setNotice] = useState("Loading private profiles…");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [profileSearch, setProfileSearch] = useState("");
  const [appearance, setAppearance] = useState<Record<string, Pick<AlterView, "appearanceNotes" | "appearanceReferenceImageIds" | "version">>>({});
  const [presence, setPresence] = useState<Record<string, "host" | "also">>({});
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const [editingVersion, setEditingVersion] = useState<number | undefined>(undefined);

  const saveAttempt = useRef<{ body: string; url: string; requestId: string } | null>(null);

  const load = async (successNotice = "Private profiles loaded.") => {
    try {
      const next = await systemRequest("GET");
      setState(next);
      setLoadState("ready");
      setNotice(successNotice);
    } catch (error) {
      setLoadState("error");
      setNotice(error instanceof Error ? error.message : "Unable to load private records.");
    }
  };

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, []);

  useEffect(() => {
    const loadPresence = async () => {
      try {
        const response = await fetch("/api/v1/presence/current", {
          headers: { "x-system-demo": "local" },
        });
        if (!response.ok) return;
        const data: { hosting?: { alterId: string } | null; fronting?: { alterId: string }[] } = await response.json();
        const presenceMap: Record<string, "host" | "also"> = {};
        if (data.hosting?.alterId) presenceMap[data.hosting.alterId] = "host";
        if (data.fronting) {
          for (const period of data.fronting) {
            if (period.alterId && !presenceMap[period.alterId]) {
              presenceMap[period.alterId] = "also";
            }
          }
        }
        setPresence(presenceMap);
      } catch {
        // Silently fail - show no badges
      }
    };

    const handlePresenceChange = () => {
      void loadPresence();
    };

    void loadPresence();
    window.addEventListener(PRESENCE_CHANGED_EVENT, handlePresenceChange);
    return () => {
      window.removeEventListener(PRESENCE_CHANGED_EVENT, handlePresenceChange);
    };
  }, []);

  const filteredProfiles = useMemo(
    () =>
      state.profiles.filter((profile) =>
        [profile.name, profile.species, ...(profile.styleTags ?? [])]
          .filter((v): v is string => Boolean(v))
          .some((value) => value.toLowerCase().includes(profileSearch.toLowerCase()))
      ),
    [state.profiles, profileSearch]
  );

  const profileIds = useMemo(() => filteredProfiles.map((p) => p.id), [filteredProfiles]);
  const [selectedId, select] = useListSelection(profileIds);
  const createHeading = useRef<HTMLHeadingElement>(null);
  const [createDraft, setCreateDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (creating) createHeading.current?.focus();
  }, [creating]);

  const currentProfile = useMemo(
    () => state.profiles.find((p) => p.id === selectedId),
    [state.profiles, selectedId]
  );

  async function saveProfile(event: FormEvent<HTMLFormElement>, profileId: string) {
    event.preventDefault();
    if (saveInFlight) return;
    setSaveInFlight(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const text = (key: string) => String(form.get(key) || "").trim();
      const list = (key: string) =>
        text(key)
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
      const body = JSON.stringify({
        name: text("name"),
        selfDescribedGender: text("gender"),
        description: text("description"),
        pronouns: text("pronouns"),
        species: text("species"),
        visualDescription: text("visualDescription"),
        presentation: text("presentation"),
        signatureTraits: list("signatureTraits"),
        styleTags: list("styleTags"),
        imageDoNotChange: list("imageDoNotChange"),
        ...(profileId ? { expectedVersion: editingVersion } : {}),
      });
      const url = profileId ? `/api/v1/alters/${profileId}` : "/api/v1/alters";
      if (saveAttempt.current?.body !== body || saveAttempt.current?.url !== url)
        saveAttempt.current = { body, url, requestId: crypto.randomUUID() };
      const response = await fetch(url, {
        method: profileId ? "PATCH" : "POST",
        headers: {
          ...demoHeaders,
          "Idempotency-Key": saveAttempt.current.requestId,
        },
        body,
      });
      const data = await response.json();
      if (response.status === 409) {
        saveAttempt.current = null;
        throw new Error(
          "This profile changed since you opened it. Your entries are still here. Copy them before reloading to review the latest profile."
        );
      }
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : data.error?.message || "Unable to save profile."
        );
      saveAttempt.current = null;
      formElement.reset();
      if (!profileId) setCreateDraft({});
      setEditing(false);
      setCreating(false);
      await load("Profile saved privately.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save profile.");
    } finally {
      setSaveInFlight(false);
    }
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight) return;
    setSaveInFlight(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const profilePicture = form.get("setAsProfilePicture") === "true";
      const requestId = crypto.randomUUID();
      if (profilePicture) form.set("requestId", requestId);
      const response = await fetch("/api/system/images", {
        method: "POST",
        headers: {
          "x-system-demo": "local",
          ...(profilePicture ? { "Idempotency-Key": requestId } : {}),
        },
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      formElement.reset();
      await load(
        profilePicture
          ? "Profile picture changed. The previous picture remains in private history."
          : "Image stored in the private gallery."
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to upload image.");
    } finally {
      setSaveInFlight(false);
    }
  }

  async function chooseProfilePicture(profile: AlterProfile, imageId: string) {
    const requestId = crypto.randomUUID();
    try {
      const response = await fetch(`/api/v1/alters/${profile.id}/profile-picture`, {
        method: "PUT",
        headers: { ...demoHeaders, "Idempotency-Key": requestId },
        body: JSON.stringify({ imageId, expectedVersion: profile.version }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : data.error?.message || "Unable to change profile picture."
        );
      await load("Profile picture changed. The previous picture remains in private history.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to change profile picture.");
    }
  }

  async function loadAppearance(profile: AlterProfile) {
    if (appearance[profile.id]) return;
    try {
      const response = await fetch(`/api/v1/alters/${profile.id}`, {
        headers: { "x-system-demo": "local" },
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Unable to load appearance settings.");
      setAppearance((current) => ({
        ...current,
        [profile.id]: data.data,
      }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to load appearance settings.");
    }
  }

  async function saveAppearance(profile: AlterProfile) {
    const current = appearance[profile.id];
    if (!current) return;
    if (saveInFlight) return;
    setSaveInFlight(true);
    try {
      const requestId = crypto.randomUUID();
      const response = await fetch(`/api/v1/alters/${profile.id}/appearance`, {
        method: "PUT",
        headers: { ...demoHeaders, "Idempotency-Key": requestId },
        body: JSON.stringify({
          appearanceNotes: current.appearanceNotes || null,
          referenceImageIds: current.appearanceReferenceImageIds,
          expectedVersion: current.version,
        }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error?.message || "Unable to save appearance settings.");
      setAppearance((items) => ({
        ...items,
        [profile.id]: data.data,
      }));
      await load("Appearance references saved. Profile picture and presence are unchanged.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save appearance settings.");
    } finally {
      setSaveInFlight(false);
    }
  }

  function updateAppearance(profileId: string, updates: Partial<Pick<AlterView, "appearanceNotes" | "appearanceReferenceImageIds">>) {
    setAppearance((current) => ({
      ...current,
      [profileId]: {
        ...current[profileId],
        ...updates,
      },
    }));
  }

  const rows = useMemo(
    () =>
      filteredProfiles.map((profile) => {
        const meta = [profile.pronouns, profile.species]
          .filter(Boolean)
          .join(" · ") || "No details yet";
        const presenceValue = presence[profile.id];
        return {
          id: profile.id,
          title: profile.name,
          meta,
          avatar: {
            src: profile.profilePicture ? privateImageUrl(profile.profilePicture.storageKey) : null,
            initials: initials(profile.name),
          },
          badge: presenceValue
            ? {
                label: presenceValue === "host" ? "Host" : "Also here",
                tone: presenceValue as "host" | "also",
              }
            : undefined,
        };
      }),
    [filteredProfiles, presence]
  );

  const detailShown = creating || Boolean(currentProfile);
  // Exactly one live notice, shown in whichever pane is visible (phones show one pane at a time).
  const statusNotice = <p className="notice profiles-notice" role="status">{notice}</p>;

  const rememberCreateDraft = (event: FormEvent<HTMLFormElement>) => {
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (field.name) setCreateDraft((draft) => ({ ...draft, [field.name]: field.value }));
  };

  const createForm = (
    <article className="detail-card profiles-detail-card" aria-labelledby="profiles-create-heading">
      <div className="profiles-detail-header">
        <h2 id="profiles-create-heading" ref={createHeading} tabIndex={-1}>Add a profile</h2>
      </div>
      {statusNotice}
      {/* A half-written profile is kept while looking at another one. */}
      <form onSubmit={(event) => saveProfile(event, "")} onChange={rememberCreateDraft} className="form-stack">
        <label>Name<input required name="name" maxLength={120} defaultValue={createDraft.name} /></label>
        <label>Self-described gender <span className="optional">optional</span><input name="gender" maxLength={120} defaultValue={createDraft.gender} /></label>
        <label>Description <span className="optional">optional</span><textarea name="description" maxLength={1000} rows={3} defaultValue={createDraft.description} /></label>
        <fieldset className="form-stack visual-identity"><legend>Visual identity</legend>
          <p>Saved identity for image prompts. Leave unknown details empty.</p>
          <label>Species<input name="species" maxLength={500} defaultValue={createDraft.species} /></label>
          <label>Visual description<textarea name="visualDescription" maxLength={1000} rows={3} defaultValue={createDraft.visualDescription} /></label>
          <label>Presentation<input name="presentation" maxLength={500} defaultValue={createDraft.presentation} /></label>
          <label>Pronouns<input name="pronouns" maxLength={500} defaultValue={createDraft.pronouns} /></label>
          <label>Signature traits — one per line<textarea name="signatureTraits" rows={3} defaultValue={createDraft.signatureTraits} /></label>
          <label>Style tags — one per line<textarea name="styleTags" rows={3} defaultValue={createDraft.styleTags} /></label>
          <label>Keep unchanged — one per line<textarea name="imageDoNotChange" rows={3} defaultValue={createDraft.imageDoNotChange} /></label>
        </fieldset>
        <div className="actions">
          <button className="button" type="submit" disabled={saveInFlight}>Add private profile</button>
          <button className="button button-secondary" type="button" onClick={() => setCreating(false)} disabled={saveInFlight}>Cancel</button>
        </div>
      </form>
    </article>
  );

  const presenceBadge = currentProfile && presence[currentProfile.id]
    ? { label: presence[currentProfile.id] === "host" ? "Host" : "Also here", tone: presence[currentProfile.id] }
    : undefined;

  const listStatus = (
    <>
      {detailShown ? null : statusNotice}
      {loadState === "error" ? (
        <div className="ld-intro">
          <p>Private records are unavailable. Sign in if needed, then try again.</p>
          <button className="button" type="button" onClick={() => void load()}>Retry loading profiles</button>
        </div>
      ) : loadState === "ready" && state.profiles.length === 0 ? (
        <p className="ld-intro">No profiles are recorded yet. Add a private profile to get started.</p>
      ) : loadState === "ready" && filteredProfiles.length === 0 ? (
        <p className="ld-intro">No matching profiles.</p>
      ) : null}
    </>
  );

  return (
    <main className="app-page">
      <AppNavigation current="PROFILES" />
      <ListDetail
        title="People"
        className="profiles-layout"
        count={loadState === "ready" ? `${state.profiles.length} ${state.profiles.length === 1 ? "profile" : "profiles"}` : undefined}
        intro={loadState === "ready" ? <p>Profiles, private pictures, and visual references. Choose a person to see or change their details.</p> : undefined}
        search={loadState === "ready" ? {
          label: "Search profiles by name, species, or style",
          placeholder: "Search name, species, or style",
          value: profileSearch,
          onChange: setProfileSearch,
        } : undefined}
        newAction={loadState === "ready" ? {
          label: "Add a profile",
          onClick: () => {
            setCreating(true);
            setEditing(false);
          },
          pressed: creating,
        } : undefined}
        rows={loadState === "ready" ? rows : []}
        selectedId={creating ? null : selectedId}
        onSelect={(id) => {
          select(id);
          setCreating(false);
          setEditing(false);
        }}
        listStatus={listStatus}
        detailLabel="Profile details"
        detailOpen={creating}
      >
        {loadState === "ready" ? (
          <>
            {creating ? createForm : null}
            {!creating && currentProfile ? (
              <ProfileDetail
                key={currentProfile.id}
                profile={currentProfile}
                appearance={appearance[currentProfile.id]}
                onLoadAppearance={loadAppearance}
                onSaveAppearance={saveAppearance}
                onUpdateAppearance={updateAppearance}
                onStartEdit={() => {
                  setEditingVersion(currentProfile.version);
                  setEditing(true);
                }}
                onSaveProfile={saveProfile}
                onChooseProfilePicture={chooseProfilePicture}
                onUploadImage={uploadImage}
                editing={editing}
                onCancelEdit={() => setEditing(false)}
                saveInFlight={saveInFlight}
                statusNotice={statusNotice}
                presenceBadge={presenceBadge}
                privateImageUrl={privateImageUrl}
              />
            ) : null}
          </>
        ) : null}
      </ListDetail>
    </main>
  );
}
