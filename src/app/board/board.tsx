"use client";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection } from "../list-detail";
import type { AlterView, NoteView, TodoView } from "@/domain/contracts";
import styles from "./board.module.css";
type Status = TodoView["status"];
const cols: [string, Status[], Status][] = [
  ["To-do", ["INBOX", "OPEN"], "OPEN"],
  ["Doing", ["IN_PROGRESS"], "IN_PROGRESS"],
  ["Blocked", ["BLOCKED"], "BLOCKED"],
  ["Done", ["DONE"], "DONE"],
];
const statusOrder: Status[] = ["BLOCKED", "IN_PROGRESS", "INBOX", "OPEN", "DONE", "CANCELLED"];
const statusLabels: Record<Status, string> = {
  BLOCKED: "Blocked",
  IN_PROGRESS: "Doing",
  INBOX: "To-do (inbox)",
  OPEN: "To-do",
  DONE: "Done",
  CANCELLED: "Cancelled",
};
async function list<T>(path: string) {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const u = new URL(path, location.origin);
    u.searchParams.set("limit", "100");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u.pathname + u.search, {
      headers: { "x-system-demo": "local" },
      cache: "no-store",
    });
    const p = await r.json();
    if (!r.ok) throw new Error(p.error?.message ?? "Unable to load Board.");
    all.push(...p.data);
    cursor = p.meta?.nextCursor;
  } while (cursor);
  return all;
}
export function Board({ view = "list" }: { view?: "list" | "board" }) {
  const [todos, setTodos] = useState<TodoView[]>([]),
    [notes, setNotes] = useState<NoteView[]>([]),
    [profiles, setProfiles] = useState<AlterView[]>([]),
    [notice, setNotice] = useState("Loading Board…"),
    [loadState, setLoadState] = useState<
      "loading" | "ready" | "unauthorized" | "error"
    >("loading"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState<string>(),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [creating, setCreating] = useState(false);
  const title = useRef<HTMLInputElement>(null),
    receipts = useRef(new Map<string, string>()),
    focusAfterMove = useRef<string | undefined>(undefined),
    feedback = useRef<HTMLParagraphElement>(null),
    createHeading = useRef<HTMLHeadingElement>(null);
  // List view selection (?id= in the URL); the board view ignores it.
  const todoIds = useMemo(() => todos.map((t) => t.id), [todos]);
  const [selectedId, select] = useListSelection(todoIds, { autoSelectFirst: view === "list" });
  const load = async () => {
    try {
      const [a, b, c] = await Promise.all([
        list<TodoView>("/api/v1/todos"),
        list<NoteView>("/api/v1/notes"),
        list<AlterView>("/api/v1/alters"),
      ]);
      setTodos(a);
      setNotes(b);
      setProfiles(c);
      setNotice("Board loaded.");
      setError("");
      setLoadState("ready");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unable to load Board.";
      setError(message);
      setLoadState(/sign in|401/i.test(message) ? "unauthorized" : "error");
    }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const put = (t: TodoView) =>
    setTodos((x) =>
      x.some((a) => a.id === t.id)
        ? x.map((a) => (a.id === t.id ? t : a))
        : [t, ...x],
    );
  const refreshTask = async (id: string) => {
    try {
      const r = await fetch(`/api/v1/todos/${id}`, {
        headers: { "x-system-demo": "local" },
        cache: "no-store",
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error?.message ?? "Unable to refresh task.");
      put(p.data);
      return true;
    } catch {
      return false;
    }
  };
  async function change(
    t: TodoView,
    body: Record<string, unknown>,
    message: string,
    path = `/api/v1/todos/${t.id}`,
    method = "PATCH",
  ): Promise<boolean> {
    if (busy) {
      focusAfterMove.current = undefined;
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": receiptFor(
            `${method}:${path}:${JSON.stringify({ expectedVersion: t.version, ...body })}`,
          ),
          "x-system-demo": "local",
        },
        body: JSON.stringify({ expectedVersion: t.version, ...body }),
      });
      const p = await r.json();
      if (!r.ok) {
        if (r.status === 409 && await refreshTask(t.id)) {
          throw new Error("Task changed. Your open draft is kept; save again to apply it to the latest task.");
        }
        throw new Error(p.error?.message ?? "Unable to save task.");
      }
      receipts.current.delete(
        `${method}:${path}:${JSON.stringify({ expectedVersion: t.version, ...body })}`,
      );
      if (method === "DELETE" && !path.includes("/checklist/")) {
        setTodos((x) => x.filter((a) => a.id !== t.id));
        if (view === "list" && selectedId === t.id) select(null);
      }
      else put(p.data);
      // The moved card is focused by the effect below, once it has re-rendered in its new column.
      setNotice(message);
      return true;
    } catch (e) {
      focusAfterMove.current = undefined;
      setError(e instanceof Error ? e.message : "Unable to save task.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function receiptFor(key: string) {
    const existing = receipts.current.get(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    receipts.current.set(key, id);
    return id;
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget,
      f = new FormData(form),
      body = {
        title: f.get("title"),
        details: f.get("details") || undefined,
        priority: f.get("priority"),
        dueOn: f.get("dueOn") || undefined,
        assigneeAlterIds: f.getAll("owners"),
        status: "OPEN",
      },
      receiptKey = `POST:/api/v1/todos:${JSON.stringify(body)}`;
    setBusy(true);
    try {
      const r = await fetch("/api/v1/todos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": receiptFor(receiptKey),
          "x-system-demo": "local",
        },
        body: JSON.stringify(body),
      });
      const p = await r.json();
      if (!r.ok) throw new Error(p.error?.message ?? "Unable to save task.");
      receipts.current.delete(receiptKey);
      put(p.data);
      form.reset();
      setNotice("Todo saved to Todos.");
      if (view === "list") {
        setCreating(false);
        select(p.data.id);
        focusAfterMove.current = p.data.id;
      } else title.current?.focus();
    } catch (x) {
      setError(x instanceof Error ? x.message : "Unable to save task.");
    } finally {
      setBusy(false);
    }
  }
  const cards = (s: Status[]) => todos.filter((t) => s.includes(t.status));
  const names = (t: TodoView) =>
    t.assigneeAlterIds.length
      ? t.assigneeAlterIds
          .map(
            (id) => profiles.find((p) => p.id === id)?.name ?? "Linked profile",
          )
          .join(", ")
      : "System-wide";
  useEffect(() => {
    const target = focusAfterMove.current;
    if (!target) return;
    const card = document.querySelector<HTMLElement>(`[data-task-id="${target}"]`);
    if (!card) return;
    focusAfterMove.current = undefined;
    card.focus();
  }, [todos]);
  useEffect(() => {
    if (notice && notice !== "Loading Board…" && notice !== "Board loaded.") feedback.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);

  const current = todos.find((t) => t.id === selectedId);

  const openCount = todos.filter((t) => !["DONE", "CANCELLED"].includes(t.status)).length;

  const listRows = statusOrder.flatMap((status) => {
    const todosForStatus = todos.filter((t) => t.status === status);
    if (todosForStatus.length === 0) return [];
    return todosForStatus.map((t) => {
      const priorityLabel = t.priority === "HIGH" ? "High" : t.priority === "LOW" ? "Low" : "Normal";
      const meta = [priorityLabel, t.dueOn].filter(Boolean).join(" · ");
      const badge =
        status === "BLOCKED"
          ? { label: "Blocked", tone: "danger" as const }
          : status === "IN_PROGRESS"
          ? { label: "Doing", tone: "also" as const }
          : undefined;
      return {
        id: t.id,
        title: t.title,
        meta,
        snippet: t.details,
        badge,
        muted: ["DONE", "CANCELLED"].includes(status),
        group: statusLabels[status],
      };
    });
  });

  useEffect(() => {
    if (view !== "list" || loadState !== "ready") return;
    const match = /^#record-(.+)$/.exec(window.location.hash);
    if (!match || !todos.some((t) => t.id === match[1])) return;
    const frame = requestAnimationFrame(() => select(match[1]));
    return () => cancelAnimationFrame(frame);
    // Only follow the addressed record once, when the Board first loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, loadState]);
  useEffect(() => {
    if (creating) createHeading.current?.focus();
  }, [creating]);

  if (view === "board") {
    return (
      <main className={styles.shell}>
      <AppNavigation current="BOARD" />
      <section className={styles.main}>
        <header className={styles.hero}>
          <div>
            <p>PRIVATE TASK BOARD</p>
            <h1>Todos</h1>
            <p>
              Move work by its actual state. Tasks stay in chronological record
              order.
            </p>
          </div>
          <div className={styles.heroActions}>
            <a className="command-button" href="#create-record">
              Add a todo
            </a>
            <Link className={styles.viewLink} href="/board">
              Open the list view
            </Link>
          </div>
        </header>
        <p className={`command-notice ${styles.status}`}>
          {notice}
        </p>
        {error && (
          <p className={styles.error} role="alert">
            {error} <button onClick={() => void load()}>Retry Board</button>
          </p>
        )}
        {loadState === "loading" && <p>Loading saved Board records…</p>}
        {loadState === "unauthorized" && (
          <p>
            <a href="/auth/login">Sign in to view your saved Board</a>
          </p>
        )}
        {loadState === "error" && (
          <button className="command-button" onClick={() => void load()}>
            Retry Board
          </button>
        )}
        {loadState === "ready" && (
          <>
            <section id="saved-records" className={styles.columns} aria-label="Task board">
              {cols.map(([name, statuses, target]) => (
                <section
                  className={styles.column}
                  key={name}
                  aria-labelledby={`col-${target}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    if (busy) return;
                    const id = e.dataTransfer.getData("text/plain");
                    const t = todos.find((x) => x.id === id);
                    if (t && !statuses.includes(t.status))
                      void change(
                        t,
                        { status: target },
                        `${t.title} moved to ${name}.`,
                      );
                  }}
                >
                  <h2 id={`col-${target}`}>
                    {name} <span>{cards(statuses).length}</span>
                  </h2>
                  {cards(statuses).map((t) => (
                    <Card
                      key={t.id}
                      todo={t}
                      profiles={profiles}
                      notes={notes}
                      names={names(t)}
                      busy={busy}
                      deleting={deleting === t.id}
                      draft={drafts[t.id] ?? ""}
                      setDraft={(v) => setDrafts((x) => ({ ...x, [t.id]: v }))}
                      move={(s) => {
                        focusAfterMove.current = t.id;
                        void change(
                          t,
                          { status: s === "INBOX" ? "OPEN" : s },
                          `${t.title} moved.`,
                        );
                      }}
                      save={(body) => change(t, body, "Task details saved.")}
                      owners={(ids) =>
                        void change(
                          t,
                          { assigneeAlterIds: ids },
                          "Owners saved.",
                        )
                      }
                      links={(ids) =>
                        void change(t, { noteIds: ids }, "Linked notes saved.")
                      }
                      checklist={(id, b, m = "PATCH") =>
                        change(
                          t,
                          b,
                          "Checklist updated.",
                          `/api/v1/todos/${t.id}/checklist${id ? `/${id}` : ""}`,
                          m,
                        )
                      }
                      remove={() => {
                        if (deleting === t.id) {
                          setDeleting(undefined);
                          void change(
                            t,
                            {},
                            "Task permanently deleted.",
                            `/api/v1/todos/${t.id}`,
                            "DELETE",
                          );
                        } else setDeleting(t.id);
                      }}
                    />
                  ))}
                </section>
              ))}
            </section>
            <section className={styles.cancelled}>
              <h2>Cancelled tasks</h2>
              <p>
                Cancelled tasks stay recoverable here until you deliberately
                delete them.
              </p>
              {cards(["CANCELLED"]).length ? (
                cards(["CANCELLED"]).map((t) => (
                  <article className={styles.cancelCard} key={t.id}>
                    <strong>{t.title}</strong>
                    <button
                      onClick={() =>
                        void change(
                          t,
                          { status: "OPEN" },
                          `${t.title} returned to To-do.`,
                        )
                      }
                    >
                      Restore to To-do
                    </button>
                  </article>
                ))
              ) : (
                <p>No cancelled tasks.</p>
              )}
            </section>
            <section id="create-record" className={styles.create}>
              <h2>Add a todo</h2>
              <form onSubmit={create}>
                <label>
                  Title
                  <input ref={title} name="title" required maxLength={500} />
                </label>
                <label>
                  Details <span>optional</span>
                  <textarea name="details" rows={3} />
                </label>
                <label>
                  Priority
                  <select name="priority" defaultValue="NORMAL">
                    <option value="LOW">Low</option>
                    <option value="NORMAL">Normal</option>
                    <option value="HIGH">High</option>
                  </select>
                </label>
                <label>
                  Due date <span>optional</span>
                  <input name="dueOn" type="date" />
                </label>
                <fieldset>
                  <legend>Assign to</legend>
                  {profiles.map((p) => (
                    <label className={styles.check} key={p.id}>
                      <input name="owners" type="checkbox" value={p.id} />
                      {p.name}
                    </label>
                  ))}
                </fieldset>
                <button className="command-button" disabled={busy}>
                  Save todo
                </button>
                <div className="form-feedback"><p ref={feedback} role="status" aria-live="polite">{busy ? "Saving…" : notice}</p><div className="task-return-links"><a href="#saved-records">View saved todos</a><Link href="/home">Back to Home</Link></div></div>
              </form>
            </section>
          </>
        )}
      </section>
    </main>
    );
  }

  // List view
  const cardFor = (t: TodoView, detail = false) => (
    <Card
      key={t.id}
      detail={detail}
      todo={t}
      profiles={profiles}
      notes={notes}
      names={names(t)}
      busy={busy}
      deleting={deleting === t.id}
      draft={drafts[t.id] ?? ""}
      setDraft={(v) => setDrafts((x) => ({ ...x, [t.id]: v }))}
      move={(s) => void change(t, { status: s === "INBOX" ? "OPEN" : s }, `${t.title} moved.`)}
      save={(body) => change(t, body, "Task details saved.")}
      owners={(ids) => void change(t, { assigneeAlterIds: ids }, "Owners saved.")}
      links={(ids) => void change(t, { noteIds: ids }, "Linked notes saved.")}
      checklist={(id, b, m = "PATCH") => change(t, b, "Checklist updated.", `/api/v1/todos/${t.id}/checklist${id ? `/${id}` : ""}`, m)}
      remove={() => {
        if (deleting === t.id) {
          setDeleting(undefined);
          void change(t, {}, "Task permanently deleted.", `/api/v1/todos/${t.id}`, "DELETE");
        } else setDeleting(t.id);
      }}
    />
  );
  const feedbackBlock = (
    <>
      {error && loadState === "ready" && (
        <p className={styles.error} role="alert">
          {error} <button className="button button-secondary" onClick={() => void load()}>Retry Board</button>
        </p>
      )}
      <p ref={feedback} className={`command-notice ${styles.status}`} role="status" aria-live="polite">{busy ? "Saving…" : notice}</p>
    </>
  );
  return (
    <main className="app-page">
      <AppNavigation current="BOARD" />
      <ListDetail
        title="Todos"
        className={styles.listView}
        count={loadState === "ready" ? `${openCount} open` : undefined}
        rows={listRows}
        selectedId={creating ? null : selectedId}
        onSelect={(id) => { setCreating(false); select(id); }}
        detailLabel="Todo details"
        detailOpen={creating}
        newAction={loadState === "ready" ? { label: "Add a todo", pressed: creating, onClick: () => setCreating(true) } : undefined}
        listStatus={
          loadState === "loading" ? (
            <p className="ld-intro">Loading saved Board records…</p>
          ) : loadState === "unauthorized" ? (
            <p className="ld-intro"><a href="/auth/login">Sign in to view your saved Board</a></p>
          ) : loadState === "error" ? (
            <div className="ld-intro"><p role="alert">{error}</p><button className="button button-secondary" onClick={() => void load()}>Retry Board</button></div>
          ) : !todos.length ? (
            <p className="ld-intro">No todos yet. Add one to get started.</p>
          ) : null
        }
        listTools={
          <p className="ld-intro"><Link href="/board?view=board" className={styles.viewLink}>Open the board view</Link></p>
        }
        emptyDetail={loadState === "ready" ? <div className="detail-card">{feedbackBlock}<p className="ld-empty">Choose a todo from the list, or add a new one.</p></div> : undefined}
      >
        {creating && loadState === "ready" ? (
          <section className={`detail-card ${styles.create}`} aria-labelledby="create-todo-heading">
            <h2 id="create-todo-heading" ref={createHeading} tabIndex={-1}>Add a todo</h2>
            <form onSubmit={create}>
              <label>
                Title
                <input ref={title} name="title" required maxLength={500} />
              </label>
              <label>
                Details <span>optional</span>
                <textarea name="details" rows={3} />
              </label>
              <label>
                Priority
                <select name="priority" defaultValue="NORMAL">
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                </select>
              </label>
              <label>
                Due date <span>optional</span>
                <input name="dueOn" type="date" />
              </label>
              <fieldset>
                <legend>Assign to</legend>
                {profiles.map((p) => (
                  <label className={styles.check} key={p.id}>
                    <input name="owners" type="checkbox" value={p.id} />
                    {p.name}
                  </label>
                ))}
              </fieldset>
              <div className="detail-actions">
                <button className="command-button" disabled={busy}>
                  Save todo
                </button>
                <button type="button" className="button button-secondary" disabled={busy} onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </div>
              {feedbackBlock}
            </form>
          </section>
        ) : current && loadState === "ready" ? (
          <div className="detail-card">
            <p className="detail-eyebrow">{statusLabels[current.status]} · {current.priority === "HIGH" ? "High" : current.priority === "LOW" ? "Low" : "Normal"} priority</p>
            <div role="group" aria-label="Status" className={styles.statusGroup}>
              {[...cols, ["Cancelled", ["CANCELLED"], "CANCELLED"] as [string, Status[], Status]].map(([label, statuses, target]) => (
                <button
                  key={target}
                  type="button"
                  aria-pressed={statuses.includes(current.status)}
                  disabled={busy || statuses.includes(current.status)}
                  onClick={() => void change(current, { status: target }, `${current.title} moved to ${label}.`)}
                >
                  {statuses.includes(current.status) ? <span aria-hidden="true">✓ </span> : null}{label}
                </button>
              ))}
            </div>
            <dl className="detail-facts">
              <div><dt>Priority</dt><dd>{current.priority === "HIGH" ? "High" : current.priority === "LOW" ? "Low" : "Normal"}</dd></div>
              <div><dt>Due date</dt><dd>{current.dueOn || "No due date"}</dd></div>
              <div><dt>Owners</dt><dd>{names(current)}</dd></div>
            </dl>
            {feedbackBlock}
            {cardFor(current, true)}
          </div>
        ) : null}
      </ListDetail>
    </main>
  );
}
function Card({
  detail = false,
  todo,
  profiles,
  notes,
  names,
  busy,
  deleting,
  draft,
  setDraft,
  move,
  save,
  owners,
  links,
  checklist,
  remove,
}: {
  detail?: boolean;
  todo: TodoView;
  profiles: AlterView[];
  notes: NoteView[];
  names: string;
  busy: boolean;
  deleting: boolean;
  draft: string;
  setDraft: (x: string) => void;
  move: (s: Status) => void;
  save: (body: Record<string, unknown>) => Promise<boolean>;
  owners: (x: string[]) => void;
  links: (x: string[]) => void;
  checklist: (
    id: string | undefined,
    b: Record<string, unknown>,
    m?: string,
  ) => Promise<boolean>;
  remove: () => void;
}) {
  const [os, setOs] = useState(todo.assigneeAlterIds),
    [ns, setNs] = useState(todo.noteIds),
    [editing, setEditing] = useState(false),
    [editTitle, setEditTitle] = useState(todo.title),
    [editDetails, setEditDetails] = useState(todo.details ?? ""),
    [checklistDrafts, setChecklistDrafts] = useState<Record<string, string>>({});
  return (
    <article
      className={detail ? `${styles.card} ${styles.detailCard}` : styles.card}
      data-task-id={todo.id}
      tabIndex={-1}
      aria-label={detail ? todo.title : undefined}
      draggable={!detail}
      onDragStart={(e) => {
        if (detail) return;
        if (busy) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("text/plain", todo.id);
      }}
    >
      {editing ? (
        <>
          <label>
            Task title
            <input
              disabled={busy}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
          </label>
          <label>
            Task details
            <textarea
              disabled={busy}
              value={editDetails}
              onChange={(e) => setEditDetails(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !editTitle.trim()}
            onClick={async () => {
              if (await save({ title: editTitle, details: editDetails || null })) {
                setEditing(false);
              }
            }}
          >
            Save task details
          </button>
        </>
      ) : (
        <>
          {detail ? <h2>{todo.title}</h2> : <h3>{todo.title}</h3>}
          {todo.details && <p>{todo.details}</p>}
          <button disabled={busy} onClick={() => setEditing(true)}>
            Edit task
          </button>
        </>
      )}
      <p>Assigned to: {names}</p>
      {todo.dueOn && <p>Due {todo.dueOn}</p>}
      <details>
        <summary>Owners</summary>
        {profiles.map((p) => (
          <label className={styles.check} key={p.id}>
            <input
              type="checkbox"
              checked={os.includes(p.id)}
              onChange={(e) =>
                setOs((x) =>
                  e.target.checked
                    ? [...x, p.id]
                    : x.filter((id) => id !== p.id),
                )
              }
            />
            {p.name}
          </label>
        ))}
        <button disabled={busy} onClick={() => owners(os)}>
          Save owners
        </button>
      </details>
      <details>
        <summary>
          Checklist ({todo.checklist.filter((x) => x.completed).length}/
          {todo.checklist.length})
        </summary>
        {todo.checklist.map((i) => (
          <div key={i.id} className={styles.item}>
            <label>
              <input
                type="checkbox"
                checked={i.completed}
                disabled={busy}
                onChange={(e) =>
                  checklist(i.id, { completed: e.target.checked })
                }
              />
              <input
                disabled={busy}
                aria-label={`Checklist item ${i.title}`}
                value={checklistDrafts[i.id] ?? i.title}
                onChange={(e) =>
                  setChecklistDrafts((current) => ({
                    ...current,
                    [i.id]: e.target.value,
                  }))
                }
                onBlur={async (e) => {
                  const next = e.target.value.trim();
                  if (!next || next === i.title) return;
                  if (await checklist(i.id, { title: next })) {
                    setChecklistDrafts((current) => {
                      const { [i.id]: _saved, ...rest } = current;
                      return rest;
                    });
                  }
                }}
              />
            </label>
            <button
              disabled={busy}
              onClick={() => checklist(i.id, {}, "DELETE")}
            >
              Remove
            </button>
          </div>
        ))}
        <div className={styles.item}>
          <input
            aria-label={`New checklist item for ${todo.title}`}
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            disabled={busy || !draft.trim()}
            onClick={async () => {
              const saved = await checklist(
                undefined,
                { title: draft, position: todo.checklist.length },
                "POST",
              );
              if (saved) setDraft("");
            }}
          >
            Add checklist item
          </button>
        </div>
      </details>
      <details>
        <summary>Linked notes ({todo.noteIds.length})</summary>
        {notes.map((n) => (
          <label className={styles.check} key={n.id}>
            <input
              type="checkbox"
              checked={ns.includes(n.id)}
              disabled={busy}
              onChange={(e) =>
                setNs((x) =>
                  e.target.checked
                    ? [...x, n.id]
                    : x.filter((id) => id !== n.id),
                )
              }
            />
            {n.body}
          </label>
        ))}
        <button disabled={busy} onClick={() => links(ns)}>
          Save linked notes
        </button>
      </details>
      {todo.noteIds.map((id) => {
        const n = notes.find((x) => x.id === id);
        return n && <blockquote key={id}>{n.body}</blockquote>;
      })}
      {/* Status controls sit below the collapsed sections so a card can be dragged from its middle. */}
      <button
        disabled={busy}
        onClick={() => move(todo.status === "DONE" ? "OPEN" : "DONE")}
      >
        {todo.status === "DONE" ? "Reopen todo" : "Mark todo complete"}
      </button>
      <label>
        Move to
        <select
          value={todo.status}
          disabled={busy}
          onChange={(e) => move(e.target.value as Status)}
        >
          <option value="INBOX">To-do (inbox)</option>
          <option value="OPEN">To-do</option>
          <option value="IN_PROGRESS">Doing</option>
          <option value="BLOCKED">Blocked</option>
          <option value="DONE">Done</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </label>
      <button disabled={busy} className={styles.delete} onClick={remove}>
        {deleting ? "Confirm deletion" : "Delete task"}
      </button>
      {deleting && (
        <p className={styles.warning}>
          This permanently deletes this task and unlinks its notes. Select
          Confirm deletion to continue.
        </p>
      )}
    </article>
  );
}
