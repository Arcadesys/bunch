"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection, type ListRow, initials } from "../list-detail";
import type { AlterView, NoteView, TodoView } from "@/domain/contracts";
import styles from "./note-journal.module.css";

type ReadState = "loading" | "ready" | "unauthorized" | "error";
type NoteDraft = { id?: string; version?: number; body: string; recipient: string; giftImageIds: string[]; taskIds: string[] };
const emptyDraft = (): NoteDraft => ({ body: "", recipient: "", giftImageIds: [], taskIds: [] });

class ReadError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

class MutationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function readPage<T>(endpoint: string) {
  const response = await fetch(endpoint, { headers: { "x-system-demo": "local" }, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new ReadError(payload.error?.message ?? "Unable to read private records.", response.status);
  return payload as { data: T[]; meta: { nextCursor?: string } };
}

async function readOne<T>(endpoint: string) {
  const response = await fetch(endpoint, { headers: { "x-system-demo": "local" }, cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new ReadError(payload.error?.message ?? "Unable to read private record.", response.status);
  return payload.data as T;
}

async function readAll<T>(endpoint: string) {
  const records: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await readPage<T>(`${endpoint}${cursor ? `${endpoint.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : ""}`);
    records.push(...page.data);
    cursor = page.meta.nextCursor;
  } while (cursor);
  return records;
}

async function loadJournal() {
  return Promise.all([readAll<NoteView>("/api/v1/notes?limit=100"), readAll<TodoView>("/api/v1/todos?limit=100"), readAll<AlterView>("/api/v1/alters?limit=100")]);
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function requestId() { return crypto.randomUUID(); }

export function NoteJournal() {
  const [notes, setNotes] = useState<NoteView[]>([]);
  const [todos, setTodos] = useState<TodoView[]>([]);
  const [profiles, setProfiles] = useState<AlterView[]>([]);
  const [state, setState] = useState<ReadState>("loading");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<NoteDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const retry = useRef(0);
  const loaded = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const receipts = useRef(new Map<string, string>());

  async function mutate(url: string, method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) {
    const key = `${method} ${url} ${JSON.stringify(body)}`;
    const id = receipts.current.get(key) ?? requestId();
    receipts.current.set(key, id);
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": id, "x-system-demo": "local" }, body: JSON.stringify(body) });
    } catch (error) {
      // The request might have reached the server. Reuse this UUID on an unchanged retry.
      throw error;
    }
    const payload = await response.json();
    if (response.ok || response.status === 400 || response.status === 409) receipts.current.delete(key);
    return { response, payload };
  }

  const reload = () => {
    const generation = ++retry.current;
    setState("loading"); setNotice("");
    void loadJournal()
      .then(([nextNotes, nextTodos, nextProfiles]) => {
        if (generation !== retry.current) return;
        setNotes(nextNotes); setTodos(nextTodos); setProfiles(nextProfiles); setState("ready");
      })
      .catch((error: unknown) => {
        if (generation !== retry.current) return;
        setState(error instanceof ReadError && error.status === 401 ? "unauthorized" : "error");
        setNotice(error instanceof Error ? error.message : "Unable to read private records.");
      });
  };

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    const generation = ++retry.current;
    void loadJournal().then(([nextNotes, nextTodos, nextProfiles]) => {
      if (generation !== retry.current) return;
      setNotes(nextNotes); setTodos(nextTodos); setProfiles(nextProfiles); setState("ready");
    }).catch((error: unknown) => {
      if (generation !== retry.current) return;
      setState(error instanceof ReadError && error.status === 401 ? "unauthorized" : "error");
      setNotice(error instanceof Error ? error.message : "Unable to read private records.");
    });
  }, []);

  useEffect(() => {
    if (notice) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);

  const ids = useMemo(() => notes.map((note) => note.id), [notes]);
  const [selectedId, select] = useListSelection(ids);

  // Links from Home and Catch-up address a note (#record-<id>) or the editor
  // (#create-record). Follow the fragment once, after the first load.
  const initialFragmentHandled = useRef(false);
  useEffect(() => {
    if (state !== "ready" || initialFragmentHandled.current) return;
    const hash = window.location.hash;
    // Runs after the list's own first-row selection so the addressed record wins.
    const frame = requestAnimationFrame(() => {
      initialFragmentHandled.current = true;
      if (hash === "#create-record") { setDraft(emptyDraft()); setIsFormOpen(true); select(null); return; }
      const hashId = hash.startsWith("#record-") ? hash.slice("#record-".length) : "";
      if (hashId && ids.includes(hashId)) select(hashId);
    });
    return () => cancelAnimationFrame(frame);
  }, [state, ids, select]);

  const tasksById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const profileImages = useMemo(() => profiles.flatMap((profile) => (profile.images ?? []).map((image, index) => ({ ...image, label: `${profile.name} · picture ${index + 1}` }))), [profiles]);

  const filteredNotes = useMemo(() => {
    if (!searchQuery) return notes;
    const query = searchQuery.toLowerCase();
    return notes.filter((note) =>
      note.body.toLowerCase().includes(query) ||
      note.alterName?.toLowerCase().includes(query)
    );
  }, [notes, searchQuery]);

  const rows: ListRow[] = filteredNotes.map((note) => {
    const firstLine = note.body.split('\n')[0] || "(empty)";
    const recipientLabel = note.alterName ?? (note.alterId ? "a linked profile" : "System-wide");
    const authorLabel = note.actorAlterName ?? "Author not recorded";
    return {
      id: note.id,
      title: firstLine,
      meta: `${authorLabel} → ${recipientLabel}`,
      time: timestamp(note.updatedAt),
      avatar: note.actorAlterName ? { initials: initials(note.actorAlterName) } : undefined,
    };
  });

  const current = notes.find((note) => note.id === selectedId);

  const edit = (note: NoteView) => {
    setDraft({ id: note.id, version: note.version, body: note.body, recipient: note.alterId ?? "", giftImageIds: note.giftImages.map((gift) => gift.imageId), taskIds: [...note.taskIds] });
    setIsFormOpen(true);
  };

  const toggleTask = (taskId: string) => setDraft((current) => ({ ...current, taskIds: current.taskIds.includes(taskId) ? current.taskIds.filter((id) => id !== taskId) : [...current.taskIds, taskId] }));
  const toggleGift = (imageId: string) => setDraft((current) => ({ ...current, giftImageIds: current.giftImageIds.includes(imageId) ? current.giftImageIds.filter((id) => id !== imageId) : current.giftImageIds.length < 8 ? [...current.giftImageIds, imageId] : current.giftImageIds }));

  async function patchLinks(note: NoteView, taskIds: string[]) {
    if (!taskIds.length) return note;
    const { response, payload } = await mutate(`/api/v1/notes/${note.id}`, "PATCH", { expectedVersion: note.version, taskIds });
    if (!response.ok) throw new MutationError(payload.error?.message ?? "Unable to link the saved note.", response.status);
    return payload.data as NoteView;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      if (draft.giftImageIds.length && !draft.recipient) throw new Error("Choose a recipient before adding an image gift.");
      if (draft.id && draft.version) {
        const { response, payload } = await mutate(`/api/v1/notes/${draft.id}`, "PATCH", { expectedVersion: draft.version, body: draft.body, taskIds: draft.taskIds });
        if (!response.ok) throw new MutationError(payload.error?.message ?? "Unable to update note.", response.status);
        const saved = payload.data as NoteView;
        setNotes((current) => current.map((note) => note.id === saved.id ? saved : note));
        setDraft(emptyDraft()); setNotice("Note updated."); setIsFormOpen(false);
      } else {
        const { response, payload } = await mutate("/api/v1/notes", "POST", { body: draft.body, alterId: draft.recipient || undefined, giftImageIds: draft.giftImageIds });
        if (!response.ok) throw new MutationError(payload.error?.message ?? "Unable to save note.", response.status);
        const created = payload.data as NoteView;
        let saved: NoteView;
        try { saved = await patchLinks(created, draft.taskIds); }
        catch (error) {
          setNotes((current) => [created, ...current]);
          setDraft({ ...draft, id: created.id, version: created.version });
          throw error;
        }
        setNotes((current) => [saved, ...current]); setDraft(emptyDraft()); setNotice("Note saved to Notes."); setIsFormOpen(false); select(saved.id);
      }
    } catch (error) {
      if (error instanceof MutationError && error.status === 409 && draft.id) {
        try {
          const latest = await readOne<NoteView>(`/api/v1/notes/${draft.id}`);
          setDraft((current) => ({ ...current, version: latest.version }));
          setNotes((current) => current.map((note) => note.id === latest.id ? latest : note));
          setNotice("Record changed. Your draft is kept; save again to apply it to the latest note.");
        } catch { setNotice("Record changed. Your draft is kept; refresh notes before retrying."); }
      } else setNotice(error instanceof Error ? error.message : "Unable to save note.");
    }
    finally { setBusy(false); }
  }

  async function erase(note: NoteView) {
    if (busy || !window.confirm(`Delete this note? ${note.taskIds.length} task reference${note.taskIds.length === 1 ? "" : "s"} will be removed; tasks remain.`)) return;
    setBusy(true); setNotice("");
    try {
      const { response, payload } = await mutate(`/api/v1/notes/${note.id}`, "DELETE", { expectedVersion: note.version });
      if (!response.ok) throw new MutationError(payload.error?.message ?? "Unable to delete note.", response.status);
      setNotes((current) => current.filter((item) => item.id !== note.id));
      if (draft.id === note.id) { setDraft(emptyDraft()); setIsFormOpen(false); }
      select(null);
      setNotice(`Note deleted. ${payload.data.removedTaskReferences ?? note.taskIds.length} task reference${(payload.data.removedTaskReferences ?? note.taskIds.length) === 1 ? "" : "s"} removed; tasks remain.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to delete note."); }
    finally { setBusy(false); }
  }

  const detailShown = isFormOpen || Boolean(current);
  const noticeText = state === "loading" ? "Loading private notes…" : busy ? "Saving…" : notice;
  // Exactly one live notice, in whichever pane is showing (phones show one pane at a time).
  const statusNotice = <p ref={feedback} role="status" aria-live="polite" className={styles.statusNotice}>{noticeText}</p>;

  const listStatus = <>
    {detailShown ? null : statusNotice}
    {state === "unauthorized" ? (
      <p className="ld-intro"><a href="/auth/login">Sign in to view your saved notes</a></p>
    ) : state === "error" ? (
      <div className="ld-intro"><p>Notes could not be loaded. This does not mean there are no notes.</p><button className="button button-secondary" onClick={reload}>Retry notes</button></div>
    ) : state === "ready" && !notes.length ? (
      <p className="ld-intro">No saved notes yet.</p>
    ) : null}
  </>;

  const detailContent = isFormOpen ? (
    <NoteForm
      draft={draft}
      setDraft={setDraft}
      todos={todos}
      profiles={profiles}
      profileImages={profileImages}
      tasksById={tasksById}
      busy={busy}
      onSave={save}
      isEditing={Boolean(draft.id)}
      onCancel={() => { setDraft(emptyDraft()); setIsFormOpen(false); }}
      toggleTask={toggleTask}
      toggleGift={toggleGift}
      statusNotice={statusNotice}
    />
  ) : current ? (
    <NoteDetail
      note={current}
      statusNotice={statusNotice}
      busy={busy}
      tasksById={tasksById}
      onEdit={() => edit(current)}
      onDelete={() => void erase(current)}
    />
  ) : null;

  return (
    <main className="app-page">
      <AppNavigation current="NOTES" />
      <ListDetail
        title="Notes"
        className={styles.layout}
        count={notes.length ? `${notes.length} saved` : undefined}
        search={{ label: "Search notes", placeholder: "Search notes", value: searchQuery, onChange: setSearchQuery }}
        newAction={{ label: "Leave a note", onClick: () => { setDraft(emptyDraft()); setIsFormOpen(true); select(null); }, pressed: isFormOpen }}
        rows={rows}
        selectedId={selectedId}
        onSelect={select}
        listStatus={listStatus}
        listTools={<button type="button" className="button button-secondary" disabled={state === "loading" || busy} onClick={reload}>Refresh notes</button>}
        detailOpen={isFormOpen}
      >
        {detailContent}
      </ListDetail>
    </main>
  );
}

function NoteDetail({ note, statusNotice, busy, tasksById, onEdit, onDelete }: { note: NoteView; statusNotice: React.ReactNode; busy: boolean; tasksById: Map<string, TodoView>; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className="detail-card" id={`record-${note.id}`}>
      <div className={styles.detailHeader}>
        <span className="detail-eyebrow">{note.alterName ?? (note.alterId ? "a linked profile" : "System-wide")}</span>
        <h2>{note.body.split('\n')[0] || "(empty)"}</h2>
        <p className={styles.detailMeta}>{note.actorAlterName ? `Written by ${note.actorAlterName}` : "Author not separately recorded"}</p>
        <p className={styles.detailTime}>{timestamp(note.updatedAt)}</p>
      </div>
      <p className={styles.detailBody}>{note.body}</p>
      <TaskLinksDetail ids={note.taskIds} tasks={tasksById} />
      {note.giftImages.length ? (
        <section aria-label="Image gifts" className={styles.giftsSection}>
          <span className="detail-eyebrow">Private image gifts</span>
          <div className={styles.gifts}>
            {note.giftImages.map((gift, index) => (
              <figure key={gift.imageId}>
                <Image src={`/api/system/gallery-images/${encodeURIComponent(gift.imageId)}`} alt={`Private image gift ${index + 1} for ${note.alterName ?? "the recipient"}`} width={240} height={240} unoptimized />
                <figcaption>Private image gift {index + 1}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
      <div className="detail-actions">
        <button className="button" disabled={busy} onClick={onEdit}>Edit note</button>
        <button className="button button-secondary" disabled={busy} onClick={onDelete}>Delete note</button>
      </div>
      {statusNotice}
    </article>
  );
}

function NoteForm({
  draft,
  setDraft,
  todos,
  profiles,
  profileImages,
  tasksById,
  busy,
  onSave,
  isEditing,
  onCancel,
  toggleTask,
  toggleGift,
  statusNotice,
}: {
  draft: NoteDraft;
  setDraft: (d: NoteDraft | ((prev: NoteDraft) => NoteDraft)) => void;
  todos: TodoView[];
  profiles: AlterView[];
  profileImages: Array<{ id: string; label: string }>;
  tasksById: Map<string, TodoView>;
  busy: boolean;
  onSave: (e: FormEvent<HTMLFormElement>) => void;
  isEditing: boolean;
  onCancel: () => void;
  toggleTask: (id: string) => void;
  toggleGift: (id: string) => void;
  statusNotice: React.ReactNode;
}) {
  const editorHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => editorHeading.current?.focus({ preventScroll: true }));
  }, []);

  return (
    <section id="create-record" className="detail-card" aria-labelledby="editor-heading">
      <h2 id="editor-heading" ref={editorHeading} tabIndex={-1}>{draft.id ? "Edit note" : "Leave a note"}</h2>
      <form onSubmit={onSave}>
        <div>
          <label htmlFor="journal-note-body">Note</label>
          <textarea id="journal-note-body" name="body" value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} disabled={busy} required rows={6} maxLength={5000} />
        </div>
        <label>
          Recipient
          <select name="recipient" value={draft.recipient} onChange={(event) => setDraft((current) => ({ ...current, recipient: event.target.value }))} disabled={busy || Boolean(draft.id)}>
            <option value="">System-wide</option>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
          {draft.id ? <span className="optional">Recipient and gifts are preserved while editing this note.</span> : null}
        </label>
        <fieldset disabled={busy}>
          <legend>Linked tasks <span className="optional">optional</span></legend>
          <p>Select every Board task this note supports. Task links update both records.</p>
          {todos.map((task) => <label className={styles.choice} key={task.id}><input type="checkbox" checked={draft.taskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /> {task.title}</label>)}
          {draft.taskIds.filter((id) => !tasksById.has(id)).map((id) => <label className={styles.choice} key={id}><input type="checkbox" checked disabled /> Unavailable linked task ({id})</label>)}
        </fieldset>
        <fieldset disabled={busy || Boolean(draft.id)}>
          <legend>Image gifts <span className="optional">optional</span></legend>
          <p>{draft.id ? "Image gifts are fixed after creation." : "Choose up to eight private gallery images. A gift needs one recipient; it stays private to this System."}</p>
          {profileImages.length ? profileImages.map((image) => <label className={styles.choice} key={image.id}><input type="checkbox" checked={draft.giftImageIds.includes(image.id)} onChange={() => toggleGift(image.id)} disabled={Boolean(draft.id) || (!draft.giftImageIds.includes(image.id) && draft.giftImageIds.length >= 8)} /> {image.label}</label>) : <p>No private gallery images are available.</p>}
        </fieldset>
        <div className="detail-actions">
          <button className="button" disabled={busy}>{draft.id ? "Save changes" : "Save note"}</button>
          {draft.id ? <button className="button button-secondary" type="button" disabled={busy} onClick={onCancel}>Cancel edit</button> : null}
        </div>
        <div className={styles.formFeedback}>
          {statusNotice}
        </div>
      </form>
    </section>
  );
}

function TaskLinksDetail({ ids, tasks }: { ids: string[]; tasks: Map<string, TodoView> }) {
  if (!ids.length) return <p className={styles.noLinksDetail}>No Board tasks linked.</p>;
  return (
    <section className={styles.tasksDetail} aria-labelledby="note-linked-tasks">
      <h3 id="note-linked-tasks" className="detail-eyebrow">Linked tasks</h3>
      <ul className={styles.tasksList}>
        {ids.map((id) => <li key={id}><Link href={`/board?id=${encodeURIComponent(id)}`}>{tasks.get(id)?.title ?? `Unavailable task (${id})`}</Link></li>)}
      </ul>
    </section>
  );
}
