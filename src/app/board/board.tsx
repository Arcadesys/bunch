"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppNavigation } from "../app-navigation";
import { ListDetail, useListSelection, initials as getInitials } from "../list-detail";
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
function getInitialView() {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    return params.get("view") === "board" ? "board" : "list";
  }
  return "list";
}

export function Board() {
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
    [view] = useState<"list" | "board">(getInitialView());
  const title = useRef<HTMLInputElement>(null),
    receipts = useRef(new Map<string, string>()),
    focusAfterMove = useRef<string | undefined>(undefined),
    feedback = useRef<HTMLParagraphElement>(null);
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
    if (busy) return false;
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
      if (method === "DELETE" && !path.includes("/checklist/"))
        setTodos((x) => x.filter((a) => a.id !== t.id));
      else put(p.data);
      if (focusAfterMove.current) {
        const target = focusAfterMove.current;
        focusAfterMove.current = undefined;
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>(`[data-task-id="${target}"]`)
            ?.focus(),
        );
      }
      setNotice(message);
      return true;
    } catch (e) {
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
      title.current?.focus();
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
    if (notice && notice !== "Loading Board…" && notice !== "Board loaded.") feedback.current?.scrollIntoView({ block: "nearest" });
  }, [notice]);

  // List view hooks (called unconditionally for proper hook ordering)
  const todoIds = todos.map((t) => t.id);
  const [selectedId, select] = useListSelection(todoIds);
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
          <a className="command-button" href="#create-record">
            Add a todo
          </a>
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
  return (
    <main className="app-page">
      <AppNavigation current="BOARD" />
      <ListDetail
        title="Todos"
        count={openCount ? `${openCount} open` : undefined}
        rows={listRows}
        selectedId={selectedId}
        onSelect={select}
        listStatus={
          loadState === "loading" ? (
            <div className="ld-intro"><p role="status">Loading todos…</p></div>
          ) : loadState === "unauthorized" ? (
            <div className="ld-intro"><p role="status"><a href="/auth/login">Sign in to view your saved Board</a></p></div>
          ) : loadState === "error" ? (
            <div className="ld-intro"><p role="status">{error}</p><button className="button button-secondary" onClick={() => void load()}>Retry Board</button></div>
          ) : null
        }
        listTools={
          <a href="/board?view=board" className="button button-secondary" style={{ display: "inline-block", marginTop: "0.5rem" }}>
            Board view
          </a>
        }
      >
        {current && loadState === "ready" ? (
          <article className="detail-card">
            <h2>{current.title}</h2>
            <div role="group" aria-label="Status">
              {(["BLOCKED", "IN_PROGRESS", "INBOX", "OPEN", "DONE", "CANCELLED"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={current.status === s}
                  onClick={() => void change(current, { status: s === "INBOX" ? "OPEN" : s }, `Status changed to ${statusLabels[s]}.`)}
                  disabled={busy}
                >
                  {statusLabels[s]}
                </button>
              ))}
            </div>
            <dl className="detail-facts">
              <div><dt>Priority</dt><dd>{current.priority === "HIGH" ? "High" : current.priority === "LOW" ? "Low" : "Normal"}</dd></div>
              <div><dt>Due date</dt><dd>{current.dueOn || "No due date"}</dd></div>
              <div><dt>Owners</dt><dd>{names(current)}</dd></div>
            </dl>
            {current.details && <p>{current.details}</p>}
            <div>
              <strong>Checklist · {current.checklist.filter((x) => x.completed).length}/{current.checklist.length}</strong>
            </div>
            {current.noteIds.length > 0 && (
              <div>
                <strong>Linked notes</strong>
                <div>
                  {notes
                    .filter((n) => current.noteIds.includes(n.id))
                    .map((n) => (
                      <div key={n.id} style={{ marginTop: "0.5rem" }}>
                        <a href="/notes">{n.body} →</a>
                      </div>
                    ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
              <button
                disabled={busy}
                onClick={() => void change(current, { status: current.status === "DONE" ? "OPEN" : "DONE" }, `Task ${current.status === "DONE" ? "reopened" : "completed"}.`)}
              >
                {current.status === "DONE" ? "Reopen todo" : "Complete todo"}
              </button>
              <button disabled={busy}>
                Edit task
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (deleting === current.id) {
                    void change(
                      current,
                      {},
                      "Task permanently deleted.",
                      `/api/v1/todos/${current.id}`,
                      "DELETE",
                    );
                  } else setDeleting(current.id);
                }}
              >
                {deleting === current.id ? "Confirm deletion" : "Delete task"}
              </button>
            </div>
            {deleting === current.id && (
              <p style={{ fontWeight: "900", borderLeft: "0.35rem solid var(--line)", paddingLeft: "0.6rem" }}>
                This permanently deletes this task and unlinks its notes.
              </p>
            )}
          </article>
        ) : null}
      </ListDetail>
      {loadState === "ready" && (
        <div style={{ padding: "1rem", borderTop: "1px solid var(--line)", maxWidth: "52rem" }}>
          <h2>Add a todo</h2>
          <form onSubmit={create} style={{ display: "grid", gap: "0.8rem" }}>
            <label style={{ display: "grid", gap: "0.35rem", fontWeight: "800" }}>
              Title
              <input ref={title} name="title" required maxLength={500} style={{ minHeight: "2.75rem", padding: "0.4rem 0.6rem" }} />
            </label>
            <label style={{ display: "grid", gap: "0.35rem", fontWeight: "800" }}>
              Details <span style={{ fontWeight: "400" }}>optional</span>
              <textarea name="details" rows={3} style={{ minHeight: "2.75rem", padding: "0.4rem 0.6rem" }} />
            </label>
            <label style={{ display: "grid", gap: "0.35rem", fontWeight: "800" }}>
              Priority
              <select name="priority" defaultValue="NORMAL" style={{ minHeight: "2.75rem", padding: "0.4rem 0.6rem" }}>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: "0.35rem", fontWeight: "800" }}>
              Due date <span style={{ fontWeight: "400" }}>optional</span>
              <input name="dueOn" type="date" style={{ minHeight: "2.75rem", padding: "0.4rem 0.6rem" }} />
            </label>
            <fieldset style={{ display: "grid", gap: "0.35rem", fontWeight: "800", border: "none", padding: 0, margin: 0 }}>
              <legend style={{ padding: 0, margin: 0 }}>Assign to</legend>
              {profiles.map((p) => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <input name="owners" type="checkbox" value={p.id} style={{ width: "1.35rem", height: "1.35rem" }} />
                  {p.name}
                </label>
              ))}
            </fieldset>
            <button className="command-button" disabled={busy} style={{ minHeight: "2.75rem" }}>
              Save todo
            </button>
            <div style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              <p ref={feedback} role="status" aria-live="polite">{busy ? "Saving…" : notice}</p>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
function Card({
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
      className={styles.card}
      data-task-id={todo.id}
      tabIndex={-1}
      draggable
      onDragStart={(e) => {
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
          <h3>{todo.title}</h3>
          {todo.details && <p>{todo.details}</p>}
          <button disabled={busy} onClick={() => setEditing(true)}>
            Edit task
          </button>
        </>
      )}
      <p>Assigned to: {names}</p>
      {todo.dueOn && <p>Due {todo.dueOn}</p>}
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
