"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AppNavigation } from "../app-navigation";
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
  const retry = useRef(0);
  const loaded = useRef(false);
  const initialFragmentHandled = useRef(false);
  const editorHeading = useRef<HTMLHeadingElement>(null);
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
    if (state !== "ready" || initialFragmentHandled.current || window.location.hash !== "#create-record") return;
    initialFragmentHandled.current = true;
    document.getElementById("create-record")?.scrollIntoView();
    requestAnimationFrame(() => editorHeading.current?.focus({ preventScroll: true }));
  }, [state]);

  useEffect(() => {
    if (notice) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);

  const tasksById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const profileImages = useMemo(() => profiles.flatMap((profile) => (profile.images ?? []).map((image, index) => ({ ...image, label: `${profile.name} · picture ${index + 1}` }))), [profiles]);
  const edit = (note: NoteView) => {
    setDraft({ id: note.id, version: note.version, body: note.body, recipient: note.alterId ?? "", giftImageIds: note.giftImages.map((gift) => gift.imageId), taskIds: [...note.taskIds] });
    document.getElementById("create-record")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    requestAnimationFrame(() => editorHeading.current?.focus());
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
        setDraft(emptyDraft()); setNotice("Note updated.");
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
        setNotes((current) => [saved, ...current]); setDraft(emptyDraft()); setNotice("Note saved to Notes.");
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
      if (draft.id === note.id) setDraft(emptyDraft());
      setNotice(`Note deleted. ${payload.data.removedTaskReferences ?? note.taskIds.length} task reference${(payload.data.removedTaskReferences ?? note.taskIds.length) === 1 ? "" : "s"} removed; tasks remain.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to delete note."); }
    finally { setBusy(false); }
  }

  return <main className={`command-shell ${styles.shell}`}><AppNavigation current="NOTES" /><section className={`command-main ${styles.main}`}>
    <header className={styles.hero}><p className="command-kicker">Private Bunch journal</p><h1>Notes</h1><p>Keep a note in one place, name its recipient and author, and link the tasks it supports.</p><a className="command-button" href="#create-record" onClick={() => requestAnimationFrame(() => editorHeading.current?.focus())}>Leave a note</a></header>
    <p className={`command-notice ${styles.notice}`}>{state === "loading" ? "Loading private notes…" : notice}</p>
    <button className="command-button secondary" disabled={state === "loading" || busy} onClick={reload}>Refresh notes</button>
    {state === "unauthorized" ? <p className={styles.problem}><a href="/auth/login">Sign in to view your saved notes</a></p> : null}
    {state === "error" ? <div className={styles.problem}><p>Notes could not be loaded. This does not mean there are no notes.</p><button className="command-button" onClick={reload}>Retry notes</button></div> : null}
    {state === "ready" ? <>
      <section className={styles.layout} aria-label="Saved Notes journal">
        <section id="saved-records" className={styles.records}><h2>Saved notes</h2>{notes.length === 0 ? <p className={styles.empty}>No saved notes yet.</p> : notes.map((note) => <article key={note.id} id={`record-${note.id}`} className={styles.note}>
          <div className={styles.noteHeader}><h3>Note for {note.alterName ?? (note.alterId ? "a linked profile" : "System-wide")}</h3><p>Updated {timestamp(note.updatedAt)}</p></div>
          <p className={styles.body}>{note.body}</p>
          <p className={styles.author}>{note.actorAlterName ? `Written by ${note.actorAlterName}` : "Author not separately recorded"}</p>
          <TaskLinks ids={note.taskIds} tasks={tasksById} />
          {note.giftImages.length ? <section aria-label="Image gifts"><h4>Private image gifts</h4><div className={styles.gifts}>{note.giftImages.map((gift, index) => <figure key={gift.imageId}><Image src={`/api/system/gallery-images/${encodeURIComponent(gift.imageId)}`} alt={`Private image gift ${index + 1} for ${note.alterName ?? "the recipient"}`} width={240} height={240} unoptimized /><figcaption>Private image gift {index + 1}</figcaption></figure>)}</div></section> : null}
          <div className={styles.actions}><button className="command-button" disabled={busy} onClick={() => edit(note)}>Edit note</button><button className="command-button secondary" disabled={busy} onClick={() => void erase(note)}>Delete note</button></div>
        </article>)}</section>
        <section id="create-record" className={styles.editor} aria-labelledby="editor-heading"><h2 id="editor-heading" ref={editorHeading} tabIndex={-1}>{draft.id ? "Edit note" : "Leave a note"}</h2><form onSubmit={save}>
          <div><label htmlFor="journal-note-body">Note</label><textarea id="journal-note-body" name="body" value={draft.body} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} disabled={busy} required rows={6} maxLength={5000} /></div>
          <label>Recipient<select name="recipient" value={draft.recipient} onChange={(event) => setDraft((current) => ({ ...current, recipient: event.target.value }))} disabled={busy || Boolean(draft.id)}><option value="">System-wide</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>{draft.id ? <span className="optional">Recipient and gifts are preserved while editing this note.</span> : null}</label>
          <fieldset disabled={busy}><legend>Linked tasks <span className="optional">optional</span></legend><p>Select every Board task this note supports. Task links update both records.</p>{todos.map((task) => <label className={styles.choice} key={task.id}><input type="checkbox" checked={draft.taskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /> {task.title}</label>)}{draft.taskIds.filter((id) => !tasksById.has(id)).map((id) => <label className={styles.choice} key={id}><input type="checkbox" checked disabled /> Unavailable linked task ({id})</label>)}</fieldset>
          <fieldset disabled={busy || Boolean(draft.id)}><legend>Image gifts <span className="optional">optional</span></legend><p>{draft.id ? "Image gifts are fixed after creation." : "Choose up to eight private gallery images. A gift needs one recipient; it stays private to this System."}</p>{profileImages.length ? profileImages.map((image) => <label className={styles.choice} key={image.id}><input type="checkbox" checked={draft.giftImageIds.includes(image.id)} onChange={() => toggleGift(image.id)} disabled={Boolean(draft.id) || (!draft.giftImageIds.includes(image.id) && draft.giftImageIds.length >= 8)} /> {image.label}</label>) : <p>No private gallery images are available.</p>}</fieldset>
          <div className={styles.actions}><button className="command-button" disabled={busy}>{draft.id ? "Save changes" : "Save note"}</button>{draft.id ? <button className="command-button secondary" type="button" disabled={busy} onClick={() => setDraft(emptyDraft())}>Cancel edit</button> : null}</div>
          <div className="form-feedback"><p ref={feedback} role="status" aria-live="polite">{busy ? "Saving…" : notice}</p><div className="task-return-links"><a href="#saved-records">View saved notes</a><Link href="/home">Back to Home</Link></div></div>
        </form></section>
      </section>
    </> : null}
  </section></main>;
}

function TaskLinks({ ids, tasks }: { ids: string[]; tasks: Map<string, TodoView> }) {
  if (!ids.length) return <p className={styles.links}>No Board tasks linked.</p>;
  return <section className={styles.links} aria-label="Linked tasks"><h4>Linked tasks</h4><ul>{ids.map((id) => <li key={id}>{tasks.get(id)?.title ?? `Unavailable task (${id})`}</li>)}</ul></section>;
}
