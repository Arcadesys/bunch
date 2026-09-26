"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

// Split view used across the app: a list pane beside a detail pane.
// Wide and mid widths show both panes. Under 760px the list shows until a row
// is chosen, then the detail replaces it with a back button.

export type ListBadgeTone = "host" | "also" | "attention" | "danger" | "neutral";

export type ListRow = {
  id: string;
  title: string;
  /** Short uppercase-style line under the title (type, author, priority…). */
  meta?: string;
  /** Right-aligned time or date. */
  time?: string;
  /** One line of body text. */
  snippet?: string;
  /** Round face for people. `src` is an image URL; `initials` shows when no image. */
  avatar?: { src?: string | null; initials: string };
  /** Square thumbnail for images. */
  thumb?: string | null;
  /** Always pairs a colour with words, never colour alone. */
  badge?: { label: string; tone: ListBadgeTone };
  /** Dims finished or reviewed rows. */
  muted?: boolean;
  /** Rows with the same group are listed under one header, in the order given. */
  group?: string;
};

export type ListDetailProps = {
  /** Page heading shown at the top of the list pane (an h1). */
  title: string;
  count?: string;
  intro?: ReactNode;
  search?: { label: string; placeholder?: string; value: string; onChange: (value: string) => void };
  newAction?: { label: string; onClick: () => void; pressed?: boolean };
  rows: ListRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Shown in the list pane when there are no rows (loading, empty, error). */
  listStatus?: ReactNode;
  /** Extra controls under the heading (filters, refresh buttons). */
  listTools?: ReactNode;
  /** Accessible name of the detail region. Defaults to the title. */
  detailLabel?: string;
  /** Shown in the detail pane when nothing is selected on wide screens. */
  emptyDetail?: ReactNode;
  /** Detail pane content for the current selection (or a create form). */
  children?: ReactNode;
  /** Set when the detail pane shows something even without a selected row, e.g. a create form. */
  detailOpen?: boolean;
  className?: string;
};

function Avatar({ avatar }: { avatar: NonNullable<ListRow["avatar"]> }) {
  return <span className="ld-avatar" aria-hidden="true">
    {avatar.src
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={avatar.src} alt="" loading="lazy" />
      : <span>{avatar.initials}</span>}
  </span>;
}

export function ListDetail({ title, count, intro, search, newAction, rows, selectedId, onSelect, listStatus, listTools, detailLabel, emptyDetail, children, detailOpen, className }: ListDetailProps) {
  const open = Boolean(selectedId) || Boolean(detailOpen);
  return <div className={`list-detail ${className ?? ""}`} data-detail-open={open ? "true" : "false"}>
    <section className="ld-list" aria-label={title}>
      <div className="ld-list-head">
        <h1>{title}</h1>
        {count ? <span className="ld-count">{count}</span> : null}
      </div>
      {intro ? <div className="ld-intro">{intro}</div> : null}
      {search ? <label className="ld-search"><span className="visually-hidden">{search.label}</span>
        <input type="search" value={search.value} placeholder={search.placeholder} onChange={event => search.onChange(event.target.value)} />
      </label> : null}
      {newAction ? <button type="button" className="ld-new" aria-pressed={newAction.pressed} onClick={newAction.onClick}>+ {newAction.label}</button> : null}
      {listTools}
      {listStatus}
      {rows.length ? <ul className="ld-rows">
        {rows.flatMap((row, index) => {
          const items: ReactNode[] = [];
          if (row.group && row.group !== rows[index - 1]?.group) items.push(<li key={`group-${row.group}`} className="ld-group" role="presentation">{row.group}</li>);
          items.push(<li key={row.id}>
            <button type="button" className="ld-row" aria-current={row.id === selectedId ? "true" : undefined} data-muted={row.muted ? "true" : undefined} onClick={() => onSelect(row.id)}>
              {row.avatar ? <Avatar avatar={row.avatar} /> : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {row.thumb ? <img className="ld-thumb" src={row.thumb} alt="" loading="lazy" /> : null}
              <span className="ld-row-text">
                <span className="ld-row-top"><span className="ld-row-title">{row.title}</span>{row.time ? <span className="ld-row-time">{row.time}</span> : null}</span>
                {row.meta ? <span className="ld-row-meta">{row.meta}</span> : null}
                {row.snippet ? <span className="ld-row-snippet">{row.snippet}</span> : null}
              </span>
              {row.badge ? <span className="ld-badge" data-tone={row.badge.tone}>{row.badge.label}</span> : null}
            </button>
          </li>);
          return items;
        })}
      </ul> : null}
    </section>
    <section className="ld-detail" aria-label={detailLabel ?? title}>
      <button type="button" className="ld-back" onClick={() => onSelect(null)}>← {title}</button>
      {open ? children : (emptyDetail ?? <p className="ld-empty">Choose an item from the list.</p>)}
    </section>
  </div>;
}

const WIDE_QUERY = "(min-width: 760px)";

/**
 * Selected row id, kept in the URL (`?id=` by default) so reload and shared
 * links return to the same item. On screens 760px and wider the first id is
 * chosen automatically when nothing is selected.
 */
export function useListSelection(ids: readonly string[], { param = "id", autoSelectFirst = true }: { param?: string; autoSelectFirst?: boolean } = {}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setSelectedId(new URLSearchParams(window.location.search).get(param));
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [param]);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set(param, id); else url.searchParams.delete(param);
    window.history.replaceState(window.history.state, "", url);
  }, [param]);

  useEffect(() => {
    if (!ready || !autoSelectFirst || !ids.length) return;
    if (selectedId && ids.includes(selectedId)) return;
    if (selectedId === null && !window.matchMedia(WIDE_QUERY).matches) return;
    const frame = requestAnimationFrame(() => setSelectedId(ids[0]));
    return () => cancelAnimationFrame(frame);
  }, [ready, autoSelectFirst, ids, selectedId]);

  return [ready ? selectedId : null, select] as const;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase() ?? "").join("") || "?";
}
