"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageAllowanceNotice } from "@/app/image-allowance";
import { RepairForm } from "./repair-form";
import type { ImageAllowance, RepairSource } from "@/domain/native-scene";
import { AppNavigation } from "@/app/app-navigation";
import { PeopleToolsNav } from "@/app/people-tools-nav";

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
  const [notice, setNotice] = useState("Describe a private image, then choose people only when their selected references should guide it.");
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
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
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not start the private image."); }
    finally { setBusy(false); }
  }

  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  return <main className="shell" style={{ maxWidth: "100%", overflowWrap: "anywhere" }}>
    <AppNavigation current="IMAGES" />
    <PeopleToolsNav current="images" />
    <header className="site-header"><div><p className="eyebrow">Bunch · private image generation</p><h1>Images</h1><p>Generate a new private scene from your words, with selected people only when you choose them.</p></div><Link className="button button-secondary" href="/gallery/generated">View photo gallery</Link></header>
    <p className="notice" role="status">{notice}</p>
    <section className="panel" aria-labelledby="generate-heading"><h2 id="generate-heading">Generate a private image</h2><p>This creates a separate private image. It does not change a profile picture, selected appearance references, hosting, or fronting.</p>
      {available === false && <p role="alert">Private image generation is not connected yet. Your prompt has not been sent.</p>}
      <form onSubmit={generate} className="upload-form"><label htmlFor="scene-prompt">Describe the image<textarea id="scene-prompt" value={scene} onChange={event => setScene(event.target.value)} minLength={1} maxLength={5000} rows={5} required /></label>
        <fieldset><legend>People to reference, optional</legend><p>Select a person to use their approved appearance references. Their private album is shown below so you can confirm which pictures are selected for image generation.</p>{people.map(person => {
          const references = new Set(person.appearanceReferenceImageIds ?? []);
          const images = person.images ?? [];
          return <div className="image-person-picker" key={person.id}>
            <label style={{ display: "block", minHeight: 44 }}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggle(person.id)} /> {person.name}{references.size ? " · selected reference available" : " · no selected reference"}</label>
            <details>
              <summary>{person.name} private album ({images.length} {images.length === 1 ? "picture" : "pictures"})</summary>
              {images.length ? <div className="private-reference-grid">{images.map((image, index) => <figure key={image.id} className="private-reference-card"><Image src={`/api/v1/images/${encodeURIComponent(image.id)}`} alt={`Private picture ${index + 1} for ${person.name}`} width={480} height={480} sizes="(max-width: 760px) 40vw, 180px" unoptimized /><figcaption>{references.has(image.id) ? "Selected appearance reference" : image.isProfilePicture ? "Profile picture; not selected as an appearance reference" : "Private album picture; not selected"}</figcaption></figure>)}</div> : <p>No private album pictures are available for {person.name}.</p>}
            </details>
          </div>;
        })}</fieldset>
        <label>Format<select value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="square">Square</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
        <ImageAllowanceNotice value={allowance} /><button className="button" type="submit" disabled={busy || pending || available === false || allowance?.remaining === 0 || allowance?.mode === "PAUSED"}>{busy ? "Starting image…" : pending ? "Image in progress…" : allowance?.mode === "PAUSED" ? "Paid images paused" : "Generate private image"}</button></form>
    </section>
    <RepairForm selected={repairSource} onSelect={setRepairSource} onSaved={load} blocked={pending || available === false || allowance?.remaining === 0 || allowance?.mode === "PAUSED"} />
    <section className="panel" aria-labelledby="history-heading"><h2 id="history-heading">Private image history</h2>{renders.length === 0 ? <p>No private images generated here yet.</p> : <ul className="recent-scenes">{renders.map(render => <li key={render.id}><article><h3>{render.state === "COMPLETE" ? "Private image ready" : render.state === "FAILED" ? "Private image failed" : "Private image in progress"}</h3><p>{render.scene}</p>{render.costMode === "ECONOMY" && <p><strong>Economy output:</strong> lower-cost generation was used. Check identity details before relying on this image; it is not automatically canon.</p>}<p role={render.state === "FAILED" ? "alert" : "status"}>{render.state === "FAILED" ? render.errorMessage ?? "Generation failed. You can try again." : render.state === "COMPLETE" ? "Saved privately." : "Generating. You can reopen this entry later."}</p>{render.state === "COMPLETE" && <><img style={{ maxWidth: "100%", height: "auto" }} src={`/api/v1/native-scenes/renders/${encodeURIComponent(render.id)}/image`} alt="Generated private image" /><p><a href={`/images?render=${encodeURIComponent(render.id)}`}>Reopen this image</a> · <a href={`/api/v1/native-scenes/renders/${encodeURIComponent(render.id)}/image`} download="private-scene.jpg">Download private image</a></p><button className="button" onClick={() => { setRepairSource({ kind: "native", id: render.id }); document.getElementById("repair-heading")?.scrollIntoView({ block: "start" }); }}>Repair this image</button></>}</article></li>)}</ul>}</section>
  </main>;
}
