"use client";
import { ImageAllowanceNotice } from "@/app/image-allowance";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppNavigation } from "@/app/app-navigation";
import { PeopleToolsNav } from "@/app/people-tools-nav";
import { type ArrangeAction, type GroupPhotoProject, type GroupPhotoRender } from "@/domain/group-photo";

type Person = { id: string; name: string; species?: string; visualDescription?: string; presentation?: string; profilePicture?: { id: string }; appearanceReferenceImageIds?: string[]; images?: { id: string; isProfilePicture?: boolean }[] };
const demoHeaders = { "x-system-demo": "local" };

function ArrowIcon({ direction }: { direction: "left" | "right" | "up" | "down" }) {
  const turns = { left: 0, up: 90, right: 180, down: 270 } as const;
  return <svg aria-hidden="true" viewBox="0 0 24 24" style={{ transform: `rotate(${turns[direction]}deg)` }}><path d="M14.5 5 7.5 12l7 7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" /></svg>;
}

function LayersIcon({ direction }: { direction: "up" | "down" }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 9 8-5 8 5-8 5-8-5Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" /><path d="m4 14 8 5 8-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /><path d={direction === "up" ? "M12 15V7m-3 3 3-3 3 3" : "M12 9v8m-3-3 3 3 3-3"} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" /></svg>;
}

function message(data: unknown, fallback: string) {
  if (typeof data === "object" && data && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string") return error;
    if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

export default function GroupPhotoPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [project, setProject] = useState<GroupPhotoProject | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Choose a place for everybody.");
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const [dragPosition, setDragPosition] = useState<{ id: string; x: number; y: number } | null>(null);
  const finishRequest = useRef<{ id: string; version: number } | null>(null);
  const [recent, setRecent] = useState<{ id: string; createdAt: string }[]>([]);
  const [finisherAvailable, setFinisherAvailable] = useState<boolean | null>(null);
  const [photoError, setPhotoError] = useState(false);
  const projectId = project?.id;
  const latestRender = project?.renders?.[0];
  const finishedPhoto = project?.renders?.find(r => r.state === "COMPLETE");
  const rendering = latestRender?.state === "QUEUED" || latestRender?.state === "RUNNING";
  const fileRef = useRef<HTMLInputElement>(null);

  const loadPeople = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/alters", { headers: demoHeaders });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Unable to load your private lineup."));
      setPeople(payload.data ?? []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to load your private lineup."); }
  }, []);

  useEffect(() => {
    void fetch("/api/v1/group-photos", { headers: demoHeaders }).then(async response => {
      if (!response.ok) return;
      const payload = await response.json();
      setRecent(Array.isArray(payload.data) ? payload.data : []);
      setFinisherAvailable(typeof payload.meta?.finisherAvailable === "boolean" ? payload.meta.finisherAvailable : null);
    }).catch(() => {});
    const id = new URLSearchParams(window.location.search).get("project");
    if (!id) return;
    saving.current = true;
    void (async () => {
      try {
        const response = await fetch(`/api/v1/group-photos/${encodeURIComponent(id)}`, { headers: demoHeaders });
        const payload = await response.json();
        if (!response.ok) throw new Error(message(payload, "Could not reopen this scene."));
        setProject(payload.data); await loadPeople(); setNotice("Saved scene reopened.");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Could not reopen this scene."); }
      finally { saving.current = false; setBusy(false); }
    })();
  }, [loadPeople]);

  useEffect(() => {
    if (!rendering || !projectId) return;
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/v1/group-photos/${projectId}`, { headers: demoHeaders, signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(message(payload, "Could not refresh photo progress. Reopen this scene to check it."));
        if (controller.signal.aborted) return;
        setProject(payload.data);
        const latest = payload.data.renders?.[0] as GroupPhotoRender | undefined;
        if (latest?.state === "COMPLETE") setNotice("Finished photo saved privately.");
        else if (latest?.state === "FAILED") setNotice(latest.errorMessage ?? "Photo finishing failed. Your scene is saved.");
      } catch (error) { if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not refresh photo progress."); }
      finally { inFlight = false; }
    };
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [rendering, projectId]);

  async function finishPhoto() {
    if (!project || saving.current || rendering) return;
    saving.current = true; setBusy(true); setPhotoError(false);
    if (finishRequest.current?.version !== project.version) finishRequest.current = { id: crypto.randomUUID(), version: project.version };
    try {
      const response = await fetch(`/api/v1/group-photos/${project.id}/renders`, { method: "POST", headers: { ...demoHeaders, "Content-Type": "application/json", "Idempotency-Key": finishRequest.current.id }, body: JSON.stringify({ expectedVersion: project.version }) });
      const payload = await response.json();
      if (!response.ok) {
        if (response.status < 500) finishRequest.current = null;
        throw new Error(message(payload, "Could not start photo finishing."));
      }
      const render = payload.data as GroupPhotoRender;
      setProject(current => current ? { ...current, renders: [render, ...(current.renders ?? []).filter(r => r.id !== render.id)] } : current);
      finishRequest.current = null;
      setNotice(render.state === "COMPLETE" ? "Finished photo saved privately." : "Finishing your photo. You can leave and reopen this scene.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not start photo finishing. Try again to check the same request."); }
    finally { saving.current = false; setBusy(false); }
  }

  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function uploadBackplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (saving.current) return;
    if (!file) { setNotice("Choose a photo first."); return; }
    setBusy(true); setNotice("Opening your scene…");
    const objectUrl = URL.createObjectURL(file);
    try {
      const form = new FormData(); form.set("backplate", file);
      const response = await fetch("/api/v1/group-photos", { method: "POST", headers: demoHeaders, body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Unable to analyze that backplate."));
      setProject(payload.data); window.history.replaceState(null, "", `?project=${payload.data.id}`); setPreviewUrl(objectUrl); await loadPeople(); setNotice("Places are ready. Drag people onto the photo, or select one and use the placement controls.");
    } catch (error) { URL.revokeObjectURL(objectUrl); setNotice(error instanceof Error ? error.message : "Unable to analyze that backplate."); }
    finally { setBusy(false); }
  }

  async function savePlacement(alterId: string, tokenX: number, tokenY: number) {
    if (!project || saving.current || rendering) return;
    saving.current = true;
    const existing = project.placements.find(p => p.alterId === alterId);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/group-photos/${project.id}/placements`, { method: "PUT", headers: { ...demoHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ alterId, tokenX, tokenY, depth: existing?.depth ?? 50, occupancyZoneId: null, relationHints: existing?.relationHints ?? [], expectedVersion: project.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not save that placement."));
      setProject(payload.data); setSelectedId(alterId); setNotice(`${people.find((person) => person.id === alterId)?.name ?? "Person"} placed at ${tokenX}% from the left, ${tokenY}% from the top.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save that placement."); }
    finally { saving.current = false; setBusy(false); }
  }

  function point(clientX: number, clientY: number) {
    const bounds = stageRef.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return null;
    return { x: Math.round(Math.min(95, Math.max(5, (clientX - bounds.left) / bounds.width * 100))), y: Math.round(Math.min(95, Math.max(5, (clientY - bounds.top) / bounds.height * 100))) };
  }

  async function arrange(action: ArrangeAction) {
    if (!project || !selectedId || saving.current || rendering) return;
    saving.current = true; setBusy(true);
    try {
      const response = await fetch(`/api/v1/group-photos/${project.id}/arrange`, { method: "PUT", headers: { ...demoHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ alterId: selectedId, action, expectedVersion: project.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not save layer order."));
      setProject(payload.data); setNotice("Layer order saved.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save layer order."); }
    finally { saving.current = false; setBusy(false); }
  }

  function move(dx: number, dy: number) {
    if (!selectedId || !project) return;
    const p = project.placements.find(p => p.alterId === selectedId);
    void savePlacement(selectedId, Math.max(5, Math.min(95, (p?.tokenX ?? 50) + dx)), Math.max(5, Math.min(95, (p?.tokenY ?? 50) + dy)));
  }

  const selected = people.find((person) => person.id === selectedId);
  const selectedPlacement = project?.placements.find(p => p.alterId === selectedId);
  const placed = new Set(project?.placements.map((placement) => placement.alterId) ?? []);
  const imageUrl = project ? `/api/v1/group-photos/${project.id}/backplate` : previewUrl;
  return <main className={`shell group-photo-page ${project ? "has-project" : ""}`}>
    {!project && <><AppNavigation current="GROUP_PHOTO" /><PeopleToolsNav current="group-photo" /></>}
    <header className="group-photo-appbar">
      {project && <a className="group-photo-back" href="/home" aria-label="Back to Bunch home"><ArrowIcon direction="left" /><span>Bunch</span></a>}
      <div className="group-photo-title"><h1>Group Photo</h1><p>{project ? "Place everyone, then finish the photo." : "Choose a place for everybody."}</p></div>
      <div className="group-photo-appbar-actions">
        <Link className="button button-secondary" href="/gallery/generated">Photo gallery</Link>
        {project && <a className="group-photo-new-scene" href="/group-photo">Start or reopen another scene</a>}
      </div>
    </header>
    {!project && <section className="panel group-photo-intro"><h2>Start with the real photo</h2><p>Choose your scene, then place people where you want them together.</p><form className="upload-form" onSubmit={uploadBackplate}><label>Choose a JPEG, PNG, or WebP photo<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" required /></label><button className="button" disabled={busy} type="submit">{busy ? "Opening scene…" : "Use this scene"}</button></form></section>}
    {!project && recent.length > 0 && <section className="panel"><h2>Recent scenes</h2><ul className="recent-scenes">{recent.map((scene, index) => <li key={scene.id}><a href={`/group-photo?project=${scene.id}`}>Open scene {index + 1} · {new Date(scene.createdAt).toLocaleDateString()}</a></li>)}</ul></section>}
    {project && <section className="group-photo-workspace" aria-label="Group Photo staging workspace">
      <div className="staging-panel"><div className="staging-heading"><div><h2>Place people</h2><p id="stage-help">Select a person, then tap the scene. Drag a placed name, use arrow keys, or use Move.</p></div><span className="group-photo-save-state" aria-hidden="true">{busy ? "Saving…" : "Saved"}</span></div>
        <div className="backplate-frame"><div ref={stageRef} className="backplate-stage" aria-label="Photo staging area" aria-describedby="stage-help"
          onClick={event => { if (event.target instanceof Element && event.target.closest("button")) return; const p = point(event.clientX, event.clientY); if (selectedId && p) void savePlacement(selectedId, p.x, p.y); }}
          onDragOver={event => event.preventDefault()}
          onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); const p = point(event.clientX, event.clientY); if (people.some(person => person.id === id) && p) void savePlacement(id, p.x, p.y); }}>
          {/* This private image must use the signed-in session rather than the public optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {imageUrl && <img draggable={false} src={imageUrl} alt="Private backplate for the group photo" />}
          {[...project.placements].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)).map(placement => {
            const person = people.find(item => item.id === placement.alterId);
            const position = dragPosition?.id === placement.alterId ? dragPosition : { x: placement.tokenX, y: placement.tokenY };
            return <button key={placement.id} type="button" aria-pressed={selectedId === placement.alterId} aria-label={`Move ${person?.name ?? "Private person"}`} aria-describedby="stage-help"
              className={`placed-token ${selectedId === placement.alterId ? "selected" : ""}`} style={{ left: `${position.x}%`, top: `${position.y}%`, zIndex: placement.depth, transform: `translate(-${position.x}%, -${position.y}%)` }}
              onClick={event => { event.stopPropagation(); setSelectedId(placement.alterId); }}
              onPointerDown={event => { if (saving.current || rendering || event.button !== 0) return; setSelectedId(placement.alterId); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: placement.alterId, x: event.clientX, y: event.clientY, moved: false }; }}
              onPointerMove={event => { const current = drag.current; if (!current) return; if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4 && !current.moved) return; const p = point(event.clientX, event.clientY); if (p) { current.moved = true; setDragPosition({ id: current.id, ...p }); } }}
              onPointerUp={event => { const current = drag.current; drag.current = null; setDragPosition(null); if (current?.moved) { const p = point(event.clientX, event.clientY); if (p) void savePlacement(current.id, p.x, p.y); } }}
              onPointerCancel={() => { drag.current = null; setDragPosition(null); }}
              onKeyDown={event => { const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; const d = directions[event.key]; if (d) { event.preventDefault(); const step = event.shiftKey ? 10 : 2; void savePlacement(placement.alterId, Math.max(5, Math.min(95, placement.tokenX + d[0] * step)), Math.max(5, Math.min(95, placement.tokenY + d[1] * step))); } }}>
              <span aria-hidden="true" className="placed-token-handle">⠿</span>{person?.name ?? "Private person"}
            </button>;
          })}
        </div></div>
        {finishedPhoto && <figure className="finished-photo">
          <figcaption><div><h3>Finished group photo</h3><p>Saved privately.{finishedPhoto.sourceVersion !== project.version ? " Your scene has changed since this photo was finished." : ""}</p></div><div className="finished-photo-actions"><a href={`/api/v1/group-photos/${project.id}/renders/${finishedPhoto.id}/image`} download="group-photo.jpg">Download finished photo</a><a href={`/images?repairKind=group&repairId=${finishedPhoto.id}`}>Repair image</a></div></figcaption>
          {/* Private images must load through the owner's session, never the public optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/v1/group-photos/${project.id}/renders/${finishedPhoto.id}/image`} alt="Finished group photo" onError={() => setPhotoError(true)} onLoad={() => setPhotoError(false)} />
          {photoError && <p role="alert">The saved photo could not be displayed. Reopen this scene to try loading it again.</p>}
        </figure>}
      </div>
      <aside className="people-tray"><div className="people-tray-heading"><h2>People</h2><p>Select someone, then place them on the photo.</p></div>{people.length === 0 ? <p>No private people are available yet. Add them in People first.</p> : <ul>{people.map((person) => <li key={person.id}><button className={`person-token ${selectedId === person.id ? "selected" : ""}`} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", person.id)} onClick={() => setSelectedId(person.id)} aria-pressed={selectedId === person.id}><span aria-hidden="true" className="person-token-mark">{selectedId === person.id ? "✓" : person.profilePicture ? "●" : "○"}</span><span>{person.name}<small>{placed.has(person.id) ? "Placed" : person.appearanceReferenceImageIds?.length ? "Reference ready" : "Needs appearance reference"}</small></span></button></li>)}</ul>}
        {selected && <section className="placement-controls" aria-labelledby="placement-controls-heading">
          <h3 id="placement-controls-heading">Move {selected.name}</h3>
          <p>{selectedPlacement ? `${selectedPlacement.tokenX}% from left · ${selectedPlacement.tokenY}% from top` : "Tap the scene or add at center, then move."}</p>
          {!selectedPlacement && <button type="button" disabled={busy || rendering} onClick={() => void savePlacement(selected.id, 50, 50)}>Add at center</button>}
          <div className="placement-grid move-grid">{([["Move left", "left", -5, 0], ["Move up", "up", 0, -5], ["Move down", "down", 0, 5], ["Move right", "right", 5, 0]] as const).map(([label, direction, dx, dy]) => <button key={label} aria-label={label} title={label} type="button" disabled={busy || rendering || !selectedPlacement} onClick={() => move(dx, dy)}><ArrowIcon direction={direction} /></button>)}</div>
          <h3>Arrange</h3><p>Layer order, from behind to in front.</p>
          <div className="placement-grid arrange-grid">{([["Bring Forward", "forward", "up"], ["Send Backward", "backward", "down"], ["Bring to Front", "front", "up"], ["Send to Back", "back", "down"]] as const).map(([label, action, direction]) => <button key={action} type="button" disabled={busy || rendering || !selectedPlacement} onClick={() => void arrange(action)}><LayersIcon direction={direction} />{label}</button>)}</div>
          <div className="layer-order"><h4>Layer order</h4><ol aria-label="Layer order, back to front">{[...project.placements].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)).map(p => <li key={p.id}>{people.find(person => person.id === p.alterId)?.name ?? "Private person"}</li>)}</ol></div>
        </section>}
      </aside>
    </section>}
    {project && <section className="photo-finisher" aria-label="Finish group photo">
      <div className="photo-finisher-status"><p className="group-photo-notice" role="status">{notice}</p>{latestRender?.state === "FAILED" && <p role="alert">{latestRender.errorMessage}</p>}</div>
      <div className="photo-finisher-actions"><ImageAllowanceNotice compact refreshKey={`${latestRender?.id}:${latestRender?.state}`} />
        <button className="button" type="button" disabled={busy || rendering || !project.placements.length || finisherAvailable === false} onClick={() => void finishPhoto()}>{rendering ? "Finishing photo…" : latestRender?.state === "FAILED" ? "Try finishing again" : "Finish photo"}</button>
      </div>
      {finisherAvailable === false && <p className="photo-finisher-unavailable">Photo finishing is not connected yet. You can keep arranging and saving this scene.</p>}
    </section>}
    {!project && <p className="notice" role="status">{notice}</p>}
  </main>;
}
