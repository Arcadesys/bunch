"use client";

import { useEffect, useRef, useState } from "react";
import { AppNavigation } from "@/app/app-navigation";
import { nearestOccupancyZone, type GroupPhotoProject } from "@/domain/group-photo";

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
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadPeople() {
    try {
      const response = await fetch("/api/v1/alters", { headers: demoHeaders });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Unable to load your private lineup."));
      setPeople(payload.data ?? []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to load your private lineup."); }
  }

  useEffect(() => () => { if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  async function uploadBackplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setNotice("Choose a photo first."); return; }
    setBusy(true); setNotice("Finding places for everyone…");
    const objectUrl = URL.createObjectURL(file);
    try {
      const form = new FormData(); form.set("backplate", file);
      const response = await fetch("/api/v1/group-photos", { method: "POST", headers: demoHeaders, body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Unable to analyze that backplate."));
      setProject(payload.data); setPreviewUrl(objectUrl); await loadPeople(); setNotice("Places are ready. Drag people onto the photo, or select one and use the placement controls.");
    } catch (error) { URL.revokeObjectURL(objectUrl); setNotice(error instanceof Error ? error.message : "Unable to analyze that backplate."); }
    finally { setBusy(false); }
  }

  async function savePlacement(alterId: string, tokenX: number, tokenY: number) {
    if (!project) return;
    const zone = nearestOccupancyZone(project.sceneAnalysis, tokenX, tokenY);
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/group-photos/${project.id}/placements`, { method: "PUT", headers: { ...demoHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ alterId, tokenX, tokenY, depth: zone.depth, occupancyZoneId: zone.id, expectedVersion: project.version }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not save that placement."));
      setProject(payload.data); setSelectedId(alterId); setNotice(`${people.find((person) => person.id === alterId)?.name ?? "Person"} is staged in ${zone.label}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save that placement."); }
    finally { setBusy(false); }
  }

  function drop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const alterId = event.dataTransfer.getData("text/plain");
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!alterId || !bounds.width || !bounds.height) return;
    void savePlacement(alterId, Math.round(Math.min(96, Math.max(4, (event.clientX - bounds.left) / bounds.width * 100))), Math.round(Math.min(94, Math.max(6, (event.clientY - bounds.top) / bounds.height * 100))));
  }

  const selected = people.find((person) => person.id === selectedId);
  const placed = new Set(project?.placements.map((placement) => placement.alterId) ?? []);
  const imageUrl = project ? `/api/v1/group-photos/${project.id}/backplate` : previewUrl;
  return <main className="shell group-photo-page">
    <AppNavigation current="GROUP_PHOTO" />
    <header className="site-header"><div><h1>Group Photo</h1><p>Choose a place for everybody.</p></div></header>
    <p className="notice" role="status">{notice}</p>
    {!project && <section className="panel group-photo-intro"><h2>Start with the real photo</h2><p>Bunch keeps the photo private and makes a saved, editable staging map. This first pass suggests broad places—not poses.</p><form className="upload-form" onSubmit={uploadBackplate}><label>Choose a JPEG, PNG, or WebP photo<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" required /></label><button className="button" disabled={busy} type="submit">{busy ? "Finding places…" : "Analyze photo"}</button></form></section>}
    {project && <section className="group-photo-workspace" aria-label="Group Photo staging workspace">
      <div className="panel staging-panel"><div className="staging-heading"><div><h2>Place people on the photo</h2><p>{project.sceneAnalysis.source === "PROVISIONAL" ? "Provisional staging zones are ready. A later vision pass can refine them without moving your people." : "Scene-aware staging zones are ready."}</p></div><span className="draft-label">Blocking pass</span></div>
        <div className="backplate-stage" onDragOver={(event) => event.preventDefault()} onDrop={drop} aria-label="Photo staging area. Drag a person here to choose their approximate place.">
          {/* This route requires the user's session; the public optimizer must not fetch it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {imageUrl && <img src={imageUrl} alt="Private backplate for the group photo" />}
          {project.sceneAnalysis.occupancyZones.map((zone) => <div key={zone.id} className={`occupancy-zone ${zone.type}`} style={{ left: `${zone.bounds.x}%`, top: `${zone.bounds.y}%`, width: `${zone.bounds.width}%`, height: `${zone.bounds.height}%` }}><span>{zone.label}</span></div>)}
          {project.placements.map((placement) => { const person = people.find((item) => item.id === placement.alterId); return <button key={placement.id} type="button" className={`placed-token ${selectedId === placement.alterId ? "selected" : ""}`} style={{ left: `${placement.tokenX}%`, top: `${placement.tokenY}%`, zIndex: placement.depth }} onClick={() => setSelectedId(placement.alterId)}>{person?.name ?? "Private person"}</button>; })}
        </div>
        <section className="zone-key" aria-label="Suggested placement areas"><h3>Suggested places</h3>{project.sceneAnalysis.occupancyZones.map((zone) => <p key={zone.id}><strong>{zone.label}</strong> · {zone.type} · up to {zone.capacity}</p>)}</section>
      </div>
      <aside className="panel people-tray"><h2>People</h2><p>Drag a token onto the photo. Profile pictures are for recognition only; later rendering uses selected appearance references.</p>{people.length === 0 ? <p>No private people are available yet. Add them in People first.</p> : <ul>{people.map((person) => <li key={person.id}><button className={`person-token ${selectedId === person.id ? "selected" : ""}`} type="button" draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", person.id)} onClick={() => setSelectedId(person.id)}><span aria-hidden="true">{person.profilePicture ? "●" : "○"}</span>{person.name}<small>{placed.has(person.id) ? "Placed" : person.appearanceReferenceImageIds?.length ? "Appearance reference selected" : "Needs selected appearance reference"}</small></button></li>)}</ul>}
        {selected && <section className="placement-controls" aria-labelledby="placement-controls-heading"><h3 id="placement-controls-heading">Place {selected.name}</h3><p>Keyboard-friendly alternative to dragging. Each move saves the approximate social placement.</p><div className="placement-grid"><button type="button" disabled={busy} onClick={() => void savePlacement(selected.id, 50, 28)}>Back row</button><button type="button" disabled={busy} onClick={() => void savePlacement(selected.id, 25, 76)}>Front left</button><button type="button" disabled={busy} onClick={() => void savePlacement(selected.id, 50, 76)}>Front center</button><button type="button" disabled={busy} onClick={() => void savePlacement(selected.id, 75, 76)}>Front right</button></div></section>}
      </aside>
    </section>}
  </main>;
}
