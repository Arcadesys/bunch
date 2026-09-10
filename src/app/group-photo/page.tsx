"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppNavigation } from "@/app/app-navigation";
import { type ArrangeAction, type GroupPhotoProject } from "@/domain/group-photo";

type Person = { id: string; name: string; species?: string; visualDescription?: string; presentation?: string; profilePicture?: { id: string }; appearanceReferenceImageIds?: string[]; images?: { id: string; isProfilePicture?: boolean }[] };
const demoHeaders = { "x-system-demo": "local" };

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
    if (!project || saving.current) return;
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
    if (!project || !selectedId || saving.current) return;
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
  return <main className="shell group-photo-page">
    <AppNavigation current="GROUP_PHOTO" />
    <header className="site-header"><div><h1>Group Photo</h1><p>Choose a place for everybody.</p></div></header>
    <p className="notice" role="status">{notice}</p>
    {!project && <section className="panel group-photo-intro"><h2>Start with the real photo</h2><p>Choose your scene, then place people where you want them together.</p><form className="upload-form" onSubmit={uploadBackplate}><label>Choose a JPEG, PNG, or WebP photo<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" required /></label><button className="button" disabled={busy} type="submit">{busy ? "Opening scene…" : "Use this scene"}</button></form></section>}
    {project && <section className="group-photo-workspace" aria-label="Group Photo staging workspace">
      <div className="panel staging-panel"><div className="staging-heading"><div><h2>Place people on the photo</h2><p>Put tokens together to keep those people together. Their places guide the composition; poses and spacing can be natural.</p></div></div>
        <p id="stage-help">Select a person, then tap the scene. Drag placed tokens to move them. Use arrow keys on a token, or the Move buttons.</p>
        <div ref={stageRef} className="backplate-stage" aria-label="Photo staging area" aria-describedby="stage-help"
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
              onPointerDown={event => { if (saving.current || event.button !== 0) return; setSelectedId(placement.alterId); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: placement.alterId, x: event.clientX, y: event.clientY, moved: false }; }}
              onPointerMove={event => { const current = drag.current; if (!current) return; if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4 && !current.moved) return; const p = point(event.clientX, event.clientY); if (p) { current.moved = true; setDragPosition({ id: current.id, ...p }); } }}
              onPointerUp={event => { const current = drag.current; drag.current = null; setDragPosition(null); if (current?.moved) { const p = point(event.clientX, event.clientY); if (p) void savePlacement(current.id, p.x, p.y); } }}
              onPointerCancel={() => { drag.current = null; setDragPosition(null); }}
              onKeyDown={event => { const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; const d = directions[event.key]; if (d) { event.preventDefault(); const step = event.shiftKey ? 10 : 2; void savePlacement(placement.alterId, Math.max(5, Math.min(95, placement.tokenX + d[0] * step)), Math.max(5, Math.min(95, placement.tokenY + d[1] * step))); } }}>
              {person?.name ?? "Private person"}
            </button>;
          })}
        </div>
      </div>
      <aside className="panel people-tray"><h2>People</h2><p>Select a person, then tap the scene to place them. Appearance references preserve their identity.</p>{people.length === 0 ? <p>No private people are available yet. Add them in People first.</p> : <ul>{people.map((person) => <li key={person.id}><button className={`person-token ${selectedId === person.id ? "selected" : ""}`} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", person.id)} onClick={() => setSelectedId(person.id)}><span aria-hidden="true">{person.profilePicture ? "●" : "○"}</span>{person.name}<small>{placed.has(person.id) ? "Placed" : person.appearanceReferenceImageIds?.length ? "Appearance reference selected" : "Needs selected appearance reference"}</small></button></li>)}</ul>}
        {selected && <section className="placement-controls" aria-labelledby="placement-controls-heading">
          <h3 id="placement-controls-heading">Move {selected.name}</h3>
          <p>{selectedPlacement ? `${selectedPlacement.tokenX}% from left · ${selectedPlacement.tokenY}% from top` : "Tap the scene or add at center, then move."}</p>
          {!selectedPlacement && <button type="button" disabled={busy} onClick={() => void savePlacement(selected.id, 50, 50)}>Add at center</button>}
          <div className="placement-grid">{([["Move left", -5, 0], ["Move right", 5, 0], ["Move up", 0, -5], ["Move down", 0, 5]] as const).map(([label, dx, dy]) => <button key={label} type="button" disabled={busy || !selectedPlacement} onClick={() => move(dx, dy)}>{label}</button>)}</div>
          <h3>Arrange</h3><p>Layer order, from behind to in front.</p>
          <div className="placement-grid">{([["Bring Forward", "forward"], ["Send Backward", "backward"], ["Bring to Front", "front"], ["Send to Back", "back"]] as const).map(([label, action]) => <button key={action} type="button" disabled={busy || !selectedPlacement} onClick={() => void arrange(action)}>{label}</button>)}</div>
          <ol aria-label="Layer order, back to front">{[...project.placements].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)).map(p => <li key={p.id}>{people.find(person => person.id === p.alterId)?.name ?? "Private person"}</li>)}</ol>
        </section>}

      </aside>
    </section>}
  </main>;
}
