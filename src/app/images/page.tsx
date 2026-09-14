"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppNavigation } from "@/app/app-navigation";

type Person = { id: string; name: string; appearanceReferenceImageIds?: string[] };
type Render = { id: string; scene: string; alterNames: string[]; state: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED"; createdAt: string; finishedAt: string | null; errorMessage: string | null; width: number | null; height: number | null };
const demoHeaders = { "x-system-demo": "local" };

function errorMessage(payload: unknown, fallback: string) {
  const error = typeof payload === "object" && payload && "error" in payload ? (payload as { error?: { message?: unknown } }).error : undefined;
  return typeof error?.message === "string" ? error.message : fallback;
}

export default function ImagesPage() {
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
    setPeople(allPeople);
    setRenders(history);
    setAvailable(typeof rendersPayload.meta?.available === "boolean" ? rendersPayload.meta.available : null);
  }, []);

  useEffect(() => { void load().catch(error => setNotice(error instanceof Error ? error.message : "Could not load private image tools.")); }, [load]);
  const pending = renders.some(render => render.state === "QUEUED" || render.state === "RUNNING");
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void load().catch(() => setNotice("Could not refresh image progress. Reopen this page to check it.")), 2_000);
    return () => window.clearInterval(timer);
  }, [load, pending]);

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
      const render = payload.data as Render;
      setRenders(current => [render, ...current.filter(item => item.id !== render.id)]);
      setNotice(render.state === "COMPLETE" ? "Private image saved. Open its preview below." : "Generating your private image. You can leave and reopen this page.");
      ids.current.delete(fingerprint);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not start the private image."); }
    finally { setBusy(false); }
  }

  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  return <main className="shell" style={{ maxWidth: "100%", overflowWrap: "anywhere" }}>
    <AppNavigation current="IMAGES" />
    <header className="site-header"><div><p className="eyebrow">Bunch · private image generation</p><h1>Images</h1><p>Generate a new private scene from your words, with selected people only when you choose them.</p></div></header>
    <p className="notice" role="status">{notice}</p>
    <section className="panel" aria-labelledby="generate-heading"><h2 id="generate-heading">Generate a private image</h2><p>This creates a separate private image. It does not change a profile picture, selected appearance references, hosting, or fronting.</p>
      {available === false && <p role="alert">Private image generation is not connected yet. Your prompt has not been sent.</p>}
      <form onSubmit={generate} className="upload-form"><label htmlFor="scene-prompt">Describe the image<textarea id="scene-prompt" value={scene} onChange={event => setScene(event.target.value)} minLength={1} maxLength={5000} rows={5} required /></label>
        <fieldset><legend>People to reference, optional</legend><p>Select only people whose approved appearance references should guide this image.</p>{people.map(person => <label key={person.id} style={{ display: "block", minHeight: 44 }}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggle(person.id)} /> {person.name}{person.appearanceReferenceImageIds?.length ? " · selected reference available" : " · no selected reference"}</label>)}</fieldset>
        <label>Format<select value={format} onChange={event => setFormat(event.target.value as typeof format)}><option value="square">Square</option><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
        <p>Uses Bunch’s image provider; daily generation limits apply.</p><button className="button" type="submit" disabled={busy || pending || available === false}>{busy ? "Starting image…" : pending ? "Image in progress…" : "Generate private image"}</button></form>
    </section>
    <section className="panel" aria-labelledby="history-heading"><h2 id="history-heading">Private image history</h2>{renders.length === 0 ? <p>No private images generated here yet.</p> : <ul className="recent-scenes">{renders.map(render => <li key={render.id}><article><h3>{render.state === "COMPLETE" ? "Private image ready" : render.state === "FAILED" ? "Private image failed" : "Private image in progress"}</h3><p>{render.scene}</p><p role={render.state === "FAILED" ? "alert" : "status"}>{render.state === "FAILED" ? render.errorMessage ?? "Generation failed. You can try again." : render.state === "COMPLETE" ? "Saved privately." : "Generating. You can reopen this entry later."}</p>{render.state === "COMPLETE" && <><img style={{ maxWidth: "100%", height: "auto" }} src={`/api/v1/native-scenes/renders/${encodeURIComponent(render.id)}/image`} alt="Generated private image" /><p><a href={`/images?render=${encodeURIComponent(render.id)}`}>Reopen this image</a> · <a href={`/api/v1/native-scenes/renders/${encodeURIComponent(render.id)}/image`} download="private-scene.jpg">Download private image</a></p></>}</article></li>)}</ul>}</section>
  </main>;
}
