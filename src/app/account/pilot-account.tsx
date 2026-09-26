"use client";
import { ImageAllowanceSettings } from "./image-allowance-settings";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ListDetail, useListSelection, type ListRow } from "../list-detail";
import { GalleryShareControls } from "./gallery-share-controls";
import { TenantInvitationControls } from "./tenant-invitation-controls";

type Account = {
  state: string;
  canShareGallery?: boolean;
  canManageTenantInvitations?: boolean;
  role?: string;
  displayName?: string;
  emailVerified: boolean;
  usedBytes: number;
  quotaBytes: number;
};
type AccountSectionId = "account" | "privacy" | "retention" | "laptop" | "gallery" | "invitations" | "images" | "delete";

/** `sections` shows the account as a split view (the Account screen); otherwise it is the single join page. */
export function PilotAccount({ join = false, sections = false }: { join?: boolean; sections?: boolean }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [images, setImages] = useState<
    Array<{ id: string; downloadUrl: string }>
  >([]);
  async function refresh() {
    try {
      const r = await fetch("/api/v1/account", { cache: "no-store" });
      if (r.ok) setAccount((await r.json()).data);
      else if (r.status !== 401)
        setMessage("Account details are unavailable. Please try again.");
    } catch {
      setMessage("Could not connect. Your entered information is still here.");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh();
      const value = new URLSearchParams(location.hash.slice(1)).get("invite");
      const saved = sessionStorage.getItem("bunch-invitation-token");
      if (value) {
        setToken(value);
        sessionStorage.setItem("bunch-invitation-token", value);
        history.replaceState(null, "", location.pathname);
      } else if (saved) setToken(saved);
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!loaded || !account || location.hash !== "#tenant-invitations-heading") return;
    const target = document.getElementById("tenant-invitations-heading");
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "start" });
      target.focus();
    });
  }, [account, loaded]);
  async function accept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/v1/pilot/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          displayName: f.get("displayName"),
          privacyAccepted: f.get("privacy") === "on",
        }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(
          result.error?.message ?? "Invitation could not be accepted.",
        );
      setToken("");
      sessionStorage.removeItem("bunch-invitation-token");
      setMessage(
        "Your private system account is ready. Add an alter profile, then connect your clients.",
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function exportRecords() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch("/api/v1/account/export", { cache: "no-store" });
      if (!r.ok)
        throw new Error("Export could not be completed. Please retry.");
      const data = await r.json();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "bunch-records.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setImages(data.images);
      setMessage(
        "Records exported. Download each original image below to complete your export.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }
  async function erase(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/v1/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: f.get("confirmation") }),
      });
      const result = await r.json();
      if (!r.ok)
        throw new Error(result.error?.message ?? "Deletion could not start.");
      setImages([]);
      setMessage(
        result.data.state === "DELETED"
          ? "Your live records and private images have been deleted. Recovery copies follow the disclosed seven-day retention window."
          : "Access is stopped. Deletion is pending; retry deletion to finish removing files.",
      );
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not confirm deletion. Check your account status before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function removeImage(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/v1/account/images/${id}`, {
        method: "DELETE",
      });
      if (!r.ok)
        throw new Error("Image deletion could not be confirmed. Please retry.");
      setImages((current) => current.filter((image) => image.id !== id));
      setMessage("The selected image was permanently deleted.");
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Image deletion failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  const canExport = Boolean(account && ["ACTIVE", "REVOKED"].includes(account.state));
  const canErase = Boolean(account && account.role === "FRIEND" && account.state !== "DELETED");
  const statusLabel = !loaded ? "Loading" : !account ? "Sign in needed" : account.state === "LEGACY" ? "Existing account" : account.state.replaceAll("_", " ").toLowerCase();
  const sectionRows: ListRow[] = [
    { id: "account", title: "Your private system account", meta: statusLabel },
    { id: "privacy", title: "Who can access your data?", meta: "Privacy" },
    { id: "retention", title: "How catch-up and deletion work", meta: "Retention" },
    ...(account?.state === "ACTIVE" ? [{ id: "laptop", title: "Laptop reference credentials", meta: "Working Monkey" }] : []),
    ...(account?.canShareGallery ? [{ id: "gallery", title: "Gallery sharing", meta: "Read-only links" }] : []),
    ...(account?.canManageTenantInvitations ? [{ id: "invitations", title: "System invitations", meta: "Friends" }] : []),
    ...(account?.role === "OPERATOR" && account.state === "ACTIVE" ? [{ id: "images", title: "Image allowance", meta: "Pilot budgets" }] : []),
    ...(canExport || canErase ? [{ id: "delete", title: "Delete this system’s account", meta: "Export first", badge: { label: "Permanent", tone: "danger" as const } }] : []),
  ];
  const sectionIds = sectionRows.map(row => row.id).join(" ");
  // Until the account loads, the permitted sections are unknown; an empty list keeps a saved ?id= from being replaced.
  const ids = useMemo(() => loaded ? sectionIds.split(" ") : [], [loaded, sectionIds]);
  const [selectedId, select] = useListSelection(ids);
  const section = ids.includes(selectedId ?? "") ? selectedId as AccountSectionId : null;

  useEffect(() => {
    // Links to #tenant-invitations-heading open the invitations section.
    if (!sections || !loaded || !account?.canManageTenantInvitations || location.hash !== "#tenant-invitations-heading") return;
    const frame = requestAnimationFrame(() => select("invitations"));
    return () => cancelAnimationFrame(frame);
  }, [sections, loaded, account, select]);
  useEffect(() => {
    if (!sections || section !== "invitations" || location.hash !== "#tenant-invitations-heading") return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById("tenant-invitations-heading");
      target?.scrollIntoView({ block: "start" });
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [sections, section]);

  if (sections) {
    const notice = message ? <p role="status" className="pilot-notice">{message}</p> : null;
    return <ListDetail title="Account" intro={<p>One login holds your system’s alters, notes, tasks, images, and recorded hosting/fronting periods.</p>}
      rows={sectionRows} selectedId={section} onSelect={select} detailLabel="Account section"
      listStatus={section ? null : notice}>
      {section ? <article className="detail-card account-section">
        {notice}
        {section === "account" ? <>
          <h2>Your private system account</h2>
          {!loaded ? (
            <p>Loading account…</p>
          ) : !account ? (
            <p>
              <a href="/auth/login?returnTo=%2Fjoin">Sign in with Google</a>. Keep
              your invitation code to paste after signing in.
            </p>
          ) : (
            <>
              <p>
                <strong>
                  Account status: {account.state === "LEGACY" ? "Existing system account" : account.state.replaceAll("_", " ")}
                </strong>
              </p>
              {account.state === "NOT_ENROLLED" ? (
                <form onSubmit={accept} className="form-stack">
                  <label>
                    Invitation code
                    <input
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      required
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    System display name
                    <input
                      name="displayName"
                      required
                      maxLength={120}
                      autoComplete="off"
                    />
                  </label>
                  {!account.emailVerified && (
                    <p>Verify your Google account email before accepting.</p>
                  )}
                  <label className="pilot-check">
                    <input type="checkbox" name="privacy" required />I understand
                    the privacy and recovery information in “Who can access your data?” and “How catch-up and deletion work”.
                  </label>
                  <button className="button" disabled={busy || !account.emailVerified}>
                    Accept invitation
                  </button>
                </form>
              ) : (
                <>
                  <h3>{account.displayName || "Account"}</h3>
                  {account.state === "ACTIVE" && (
                    <>
                      <p>
                        Image storage: {(account.usedBytes / 1048576).toFixed(1)} MB
                        {account.role === "FRIEND"
                          ? ` of ${(account.quotaBytes / 1048576).toFixed(0)} MB`
                          : ""}
                        .
                      </p>
                      <p>
                        <a href="/profiles">Add or manage alter profiles</a>
                      </p>
                    </>
                  )}
                  {account.state === "LEGACY" && <p>Your existing system and records are available. No pilot invitation or re-enrollment is needed. <a href="/profiles">Manage your profiles</a>.</p>}
                </>
              )}
            </>
          )}
          <p><Link href="/connect">Connect clients</Link></p>
        </> : null}
        {section === "privacy" ? <>
          <h2>Who can access your data?</h2>
          <p>
            Other systems cannot access your records. The hosting operator can
            technically access stored data for administration. This is not
            end-to-end encryption.
          </p>
          <p>
            Your connected ChatGPT or Codex account receives the records you
            request. Bunch does not automatically receive your conversation
            history. Generated catch-up summaries are saved privately for 30 days,
            with their dates and coverage gaps. Raw transcripts are not saved.
          </p>
        </> : null}
        {section === "retention" ? <>
          <h2>How catch-up and deletion work</h2>
          <p>
            Your connected ChatGPT or Codex account receives the records you
            request. Bunch does not automatically receive your conversation
            history. Generated catch-up summaries are saved privately for 30 days,
            with their dates and coverage gaps. Raw transcripts are not saved.
          </p>
          <p>
            Deletion removes live records and images. The pilot requires
            encrypted recovery copies that expire within seven days. A minimal
            deletion record remains to prevent accidental reactivation.
          </p>
        </> : null}
        {section === "laptop" ? <>
          <h2>Laptop reference credentials</h2>
          <p>
            Create a credential for one laptop and an explicit set of profiles. The plaintext credential is shown once. Revocation takes effect on the next request.
          </p>
          <p><a href="/account/reference-credentials" className="button">Manage laptop reference credentials</a></p>
        </> : null}
        {section === "gallery" ? <GalleryShareControls /> : null}
        {section === "invitations" ? <TenantInvitationControls /> : null}
        {section === "images" ? <ImageAllowanceSettings /> : null}
        {section === "delete" ? <>
          <h2>Delete this system’s account</h2>
          <p>
            This permanently removes this system’s live records and
            images. Export first if you want a copy. Access stops as
            soon as deletion starts.
          </p>
          {canExport && (
            <p>
              <button onClick={() => void exportRecords()} disabled={busy} className="button button-secondary">
                Export records and image list
              </button>
            </p>
          )}
          {images.length > 0 && (
            <ul>
              {images.map((image, index) => (
                <li key={image.id}>
                  <a href={image.downloadUrl}>
                    Download original image {index + 1}
                  </a>
                  {canExport && (
                    <details>
                      <summary>Delete image {index + 1}</summary>
                      <p>
                        This permanently deletes this image, including its
                        profile-picture selection.
                      </p>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => void removeImage(image.id)}
                      >
                        Confirm permanent image deletion
                      </button>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canErase && account && (
            <form onSubmit={erase} className="form-stack">
              <label>
                Type DELETE MY SYSTEM
                <input
                  name="confirmation"
                  required
                  pattern="DELETE MY SYSTEM"
                  autoComplete="off"
                />
              </label>
              <button className="button" disabled={busy}>
                {account.state === "DELETING"
                  ? "Retry deletion"
                  : "Permanently delete my system"}
              </button>
            </form>
          )}
        </> : null}
      </article> : null}
    </ListDetail>;
  }

  // Legacy mode: render full page with all sections
  return (
    <main className="pilot-page">
      <nav aria-label="Account navigation">
        <Link href="/home">Bunch</Link>
        <a href="/account">Account & privacy</a>
        <a href="/connect">Connect clients</a>
      </nav>
      <h1>
        {join ? "Join the Bunch friends pilot" : "Your private system account"}
      </h1>
      <p>
        One login holds your system’s alters, notes, tasks, images, and recorded
        hosting/fronting periods.
      </p>
      <section aria-labelledby="privacy-heading">
        <h2 id="privacy-heading">Who can access your data?</h2>
        <p>
          Other systems cannot access your records. The hosting operator can
          technically access stored data for administration. This is not
          end-to-end encryption.
        </p>
        <details>
          <summary>How catch-up and deletion work</summary>
          <p>
            Your connected ChatGPT or Codex account receives the records you
            request. Bunch does not automatically receive your conversation
            history. Generated catch-up summaries are saved privately for 30 days,
            with their dates and coverage gaps. Raw transcripts are not saved.
          </p>
          <p>
            Deletion removes live records and images. The pilot requires
            encrypted recovery copies that expire within seven days. A minimal
            deletion record remains to prevent accidental reactivation.
          </p>
        </details>
      </section>
      {message && (
        <p role="status" className="pilot-notice">
          {message}
        </p>
      )}
      {!loaded ? (
        <p>Loading account…</p>
      ) : !account ? (
        <p>
          <a href="/auth/login?returnTo=%2Fjoin">Sign in with Google</a>. Keep
          your invitation code to paste after signing in.
        </p>
      ) : (
        <>
          <p>
            <strong>
              Account status: {account.state === "LEGACY" ? "Existing system account" : account.state.replaceAll("_", " ")}
            </strong>
          </p>
          {account.state === "NOT_ENROLLED" ? (
            <form onSubmit={accept}>
              <label>
                Invitation code
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label>
                System display name
                <input
                  name="displayName"
                  required
                  maxLength={120}
                  autoComplete="off"
                />
              </label>
              {!account.emailVerified && (
                <p>Verify your Google account email before accepting.</p>
              )}
              <label className="pilot-check">
                <input type="checkbox" name="privacy" required />I understand
                the privacy and recovery information above.
              </label>
              <button disabled={busy || !account.emailVerified}>
                Accept invitation
              </button>
            </form>
          ) : (
            <>
              <h2>{account.displayName || "Account"}</h2>
              {account.state === "ACTIVE" && (
                <>
                  <p>
                    Image storage: {(account.usedBytes / 1048576).toFixed(1)} MB
                    {account.role === "FRIEND"
                      ? ` of ${(account.quotaBytes / 1048576).toFixed(0)} MB`
                      : ""}
                    .
                  </p>
                  <p>
                    <a href="/profiles">Add or manage alter profiles</a>
                  </p>
                  <p>
                    <a href="/account/reference-credentials">Manage laptop reference credentials</a>
                  </p>
                </>
              )}
              {account.state === "LEGACY" && <p>Your existing system and records are available. No pilot invitation or re-enrollment is needed. <a href="/profiles">Manage your profiles</a>.</p>}
              {account.canShareGallery && <GalleryShareControls />}
              {account.canManageTenantInvitations && <TenantInvitationControls />}
              {["ACTIVE", "REVOKED"].includes(account.state) && (
                <button onClick={() => void exportRecords()} disabled={busy}>
                  Export records and image list
                </button>
              )}
              {images.length > 0 && (
                <ul>
                  {images.map((image, index) => (
                    <li key={image.id}>
                      <a href={image.downloadUrl}>
                        Download original image {index + 1}
                      </a>
                      {(account.state === "ACTIVE" || account.state === "REVOKED") && (
                        <details>
                          <summary>Delete image {index + 1}</summary>
                          <p>
                            This permanently deletes this image, including its
                            profile-picture selection.
                          </p>
                          <button
                            disabled={busy}
                            onClick={() => void removeImage(image.id)}
                          >
                            Confirm permanent image deletion
                          </button>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {account.role === "FRIEND" && account.state !== "DELETED" && (
                <details>
                  <summary>Delete this system’s account</summary>
                  <p>
                    This permanently removes this system’s live records and
                    images. Export first if you want a copy. Access stops as
                    soon as deletion starts.
                  </p>
                  <form onSubmit={erase}>
                    <label>
                      Type DELETE MY SYSTEM
                      <input
                        name="confirmation"
                        required
                        pattern="DELETE MY SYSTEM"
                        autoComplete="off"
                      />
                    </label>
                    <button disabled={busy}>
                      {account.state === "DELETING"
                        ? "Retry deletion"
                        : "Permanently delete my system"}
                    </button>
                  </form>
                </details>
              )}
            </>
          )}
        </>
      )}
    {account?.role === "OPERATOR" && account.state === "ACTIVE" && <ImageAllowanceSettings />}</main>
  );
}
