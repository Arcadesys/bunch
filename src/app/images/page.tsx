"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ImageAllowanceNotice } from "@/app/image-allowance";
import { RepairForm } from "./repair-form";
import type { ImageAllowance, RepairSource } from "@/domain/native-scene";
import { AppNavigation } from "@/app/app-navigation";
import { ListDetail, useListSelection, type ListRow } from "@/app/list-detail";

type PersonImage = { id: string; isProfilePicture?: boolean; contentType?: string };
type Person = { id: string; name: string; appearanceReferenceImageIds?: string[]; images?: PersonImage[] };
type Render = { id: string; scene: string; alterNames: string[]; state: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED"; createdAt: string; finishedAt: string | null; errorMessage: string | null; width: number | null; height: number | null; model: string; quality: "low" | "medium" | "high"; costMode: "STANDARD" | "ECONOMY" | "PAUSED" };
const demoHeaders = { "x-system-demo": "local" };

function errorMessage(payload: unknown, fallback: string) {
  const error = typeof payload === "object" && payload && "error" in payload ? (payload as { error?: { message?: unknown } }).error : undefined;
  return typeof error?.message === "string" ? error.message : fallback;
}

export default function ImagesPage() {
  const [allowance, setAllowance] = useState<ImageAllowance | null>(null);
  const [repairSource, setRepairSource] = useState<RepairSource | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [renders, setRenders] = useState<Render[]>([]);
  const [scene, setScene] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<"square" | "landscape" | "portrait">("square");
  const [notice, setNotice] = useState("");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const ids = useRef(new Map<string, string>());

  const load = useCallback(async () => {
    const [peopleResponse, rendersResponse] = await Promise.all([fetch("/api/v1/alters?limit=100", { headers: demoHeaders }), fetch("/api/v1/native-scenes/renders", { headers: demoHeaders })]);
    const peoplePayload = await peopleResponse.json();
    const rendersPayload = await rendersResponse.json();
    if (!peopleResponse.ok) throw new Error(errorMessage(peoplePayload, "Could not load private people."));
    if (!rendersResponse.ok) throw new Error(errorMessage(rendersPayload, "Could not load image history."));
    const allPeople = Array.isArray(peoplePayload.data) ? [...peoplePayload.data] : [];
    for (let cursor = peoplePayload.meta?.nextCursor; cursor; ) { const page = await fetch(`/api/v1/alters?limit=100&cursor=${encodeURIComponent(cursor)}`, { headers: demoHeaders }).then(response => response.json()); allPeople.push(...(Array.isArray(page.data) ? page.data : [])); cursor = page.meta?.nextCursor; }
    const history: Render[] = Array.isArray(rendersPayload.data) ? rendersPayload.data : [];
    const requested = new URLSearchParams(window.location.search).get("render");
    if (requested && !history.some(render => render.id === requested)) { const response = await fetch(`/api/v1/native-scenes/renders/${encodeURIComponent(requested)}`, { headers: demoHeaders }); const payload = await response.json(); if (response.ok) history.unshift(payload.data); }
    setAllowance(rendersPayload.meta?.allowance ?? null);
    setPeople(allPeople);
    setRenders(history);
    setAvailable(typeof rendersPayload.meta?.available === "boolean" ? rendersPayload.meta.available : null);
  }, []);

  // load only updates state after network responses; there is no synchronous derived-state update.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load().catch(error => setNotice(error instanceof Error ? error.message : "Could not load private image tools.")); }, [load]);
  const pending = renders.some(render => render.state === "QUEUED" || render.state === "RUNNING");
  useEffect(() => {
    const timer = window.setInterval(() => void load().catch(() => setNotice("Could not refresh image progress. Reopen this page to check it.")), pending ? 2_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [load, pending]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const kind = query.get("repairKind"), id = query.get("repairId");
    // The browser URL is external state unavailable during server rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id && (kind === "private" || kind === "native" || kind === "group")) setRepairSource({ kind, id });
  }, []);

  async function generate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = scene.trim();
    if (!trimmed) { setNotice("Describe the image before generating it."); return; }
    setBusy(true);
    const fingerprint = `${trimmed}\u0000${selected.join(",")}\u0000${format}`;
    const requestId = ids.current.get(fingerprint) ?? crypto.randomUUID();
    ids.current.set(fingerprint, requestId);
    try {
      const response = await fetch("/api/v1/native-scenes/renders", { method: "POST", headers: { ...demoHeaders, "Content-Type": "application/json", "Idempotency-Key": requestId }, body: JSON.stringify({ scene: trimmed, alterNames: selected.map(id => people.find(person => person.id === id)?.name).filter((name): name is string => Boolean(name)), format }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Could not start the private image."));
      if (payload.meta?.allowance) setAllowance(payload.meta.allowance);
      const render = payload.data as Render;
      setRenders(current => [render, ...current.filter(item => item.id !== render.id)]);
      const economy = render.costMode === "ECONOMY" ? " Economy mode uses lower-cost output; treat identity details as provisional." : "";
      setNotice((render.state === "COMPLETE" ? "Private image saved. Open its preview below." : "Generating your private image. You can leave and reopen this page.") + economy);
      ids.current.delete(fingerprint);
      setCreatingNew(false);
      select(render.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not start the private image."); }
    finally { setBusy(false); }
  }

  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }

  // Build list rows
  const rows: ListRow[] = useMemo(() => {
    const result: ListRow[] = [
      { id: "new", title: "+ New image", meta: "Describe a scene", group: "Start" }
    ];
    renders.forEach(render => {
      result.push({
        id: render.id,
        title: render.scene,
        meta: render.state === "COMPLETE" ? "Square" : render.state === "FAILED" ? "Failed" : "Generating",
        time: render.createdAt ? new Date(render.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "",
        thumb: render.state === "COMPLETE" ? `/api/v1/native-scenes/renders/${encodeURIComponent(render.id)}/image` : undefined,
        group: "Private image history",
      });
    });
    return result;
  }, [renders]);

  const ids_list = useMemo(() => rows.map(r => r.id), [rows]);
  const [selectedId, select] = useListSelection(ids_list, { autoSelectFirst: true, param: "id" });

  const current = selectedId === "new" ? null : renders.find(render => render.id === selectedId);

  return <main className="app-page">
    <AppNavigation current="IMAGES" />
    <ListDetail
      title="Create images"
      count={renders.length ? `${renders.length} made` : undefined}
      rows={rows}
      selectedId={selectedId}
      onSelect={select}
      listStatus={renders.length === 0 && selectedId !== "new" ? <p role="status">No private images generated here yet.</p> : null}
    >
      {selectedId === "new" ? (
        <div className="detail-card">
          <h2>Generate a private image</h2>
          <p>This creates a separate private image. It does not change a profile picture, selected appearance references, hosting, or fronting.</p>
          {available === false && <p role="alert">Private image generation is not connected yet. Your prompt has not been sent.</p>}
          <form onSubmit={generate} className="form-stack">
            <label>
              Describe the image
              <textarea value={scene} onChange={event => setScene(event.target.value)} minLength={1} maxLength={5000} rows={4} required />
            </label>
            <fieldset>
              <legend>People to reference, optional</legend>
              <p>Select a person to use their approved appearance references. Their private album is shown below so you can confirm which pictures are selected for image generation.</p>
              {people.map(person => {
                const references = new Set(person.appearanceReferenceImageIds ?? []);
                const images = person.images ?? [];
                return <div className="image-person-picker" key={person.id}>
                  <label style={{ display: "block", minHeight: 44 }}>
                    <input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggle(person.id)} /> {person.name}{references.size ? " · selected reference available" : " · no selected reference"}
                  </label>
                  <details>
                    <summary>{person.name} private album ({images.length} {images.length === 1 ? "picture" : "pictures"})</summary>
                    {images.length ? <div className="private-reference-grid">{images.map((image, index) => <figure key={image.id} className="private-reference-card"><Image src={`/api/v1/images/${encodeURIComponent(image.id)}`} alt={`Private picture ${index + 1} for ${person.name}`} width={480} height={480} sizes="(max-width: 760px) 40vw, 180px" unoptimized /><figcaption>{references.has(image.id) ? "Selected appearance reference" : image.isProfilePicture ? "Profile picture; not selected as an appearance reference" : "Private album picture; not selected"}</figcaption></figure>)}</div> : <p>No private album pictures are available for {person.name}.</p>}
                  </details>
                </div>;
              })}
            </fieldset>
            <label>
              Format
              <select value={format} onChange={event => setFormat(event.target.value as typeof format)}>
                <option value="square">Square</option>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
              </select>
            </label>
            <ImageAllowanceNotice value={allowance} />
            <button className="button" type="submit" disabled={busy || pending || available === false || allowance?.remaining === 0 || allowance?.mode === "PAUSED"}>
              {busy ? "Starting image…" : pending ? "Image in progress…" : allowance?.mode === "PAUSED" ? "Paid images paused" : "Generate private image"}
            </button>
          </form>
          {notice && <p role="status">{notice}</p>}
        </div>
      ) : current ? (
        <div className="detail-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {current.state === "COMPLETE" && <img style={{ maxWidth: "100%", height: "auto" }} src={`/api/v1/native-scenes/renders/${encodeURIComponent(current.id)}/image`} alt="Generated private image" />}
          <h3>
            {current.state === "COMPLETE" ? "Private image ready" : current.state === "FAILED" ? "Private image failed" : "Private image in progress"}
          </h3>
          {current.state === "COMPLETE" && (
            <div className="detail-facts">
              <div>
                <dt>Format</dt>
                <dd>Square</dd>
              </div>
            </div>
          )}
          <p>{current.scene}</p>
          {current.costMode === "ECONOMY" && (
            <p><strong>Economy output:</strong> lower-cost generation was used. Check identity details before relying on this image; it is not automatically canon.</p>
          )}
          {current.state === "FAILED" && <p role="alert">{current.errorMessage ?? "Generation failed. You can try again."}</p>}
          {current.state !== "FAILED" && current.state !== "COMPLETE" && <p role="status">Generating. You can reopen this entry later.</p>}
          {current.state === "COMPLETE" && (
            <div className="detail-actions">
              <a href={`/api/v1/native-scenes/renders/${encodeURIComponent(current.id)}/image`} download="private-scene.jpg" className="button">Download private image</a>
              <button className="button button-secondary" onClick={() => { setRepairSource({ kind: "native", id: current.id }); }}>Repair this image</button>
            </div>
          )}
        </div>
      ) : null}
      <RepairForm selected={repairSource} onSelect={setRepairSource} onSaved={load} blocked={pending || available === false || allowance?.remaining === 0 || allowance?.mode === "PAUSED"} />
    </ListDetail>
  </main>;
}
