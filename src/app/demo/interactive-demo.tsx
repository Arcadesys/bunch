"use client";

/* eslint-disable @next/next/no-img-element -- Local blob previews must never go through an image service. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { getDemoSystem } from "@/server/demo-system";
import { ThemeControl } from "../theme-control";
import { DEMO_APPEARANCE_CACHE_KEY, APPEARANCE_PREVIEW_EVENT, applyAppearance } from "../appearance-provider";
import { defaultAppearance } from "@/domain/appearance";
import styles from "./demo.module.css";

type Sample = ReturnType<typeof getDemoSystem>;
type Person = Sample["people"][number]["id"];
type Picture = { id: number; person: Person; caption: string; url?: string; night?: boolean };
type View = "return" | "photos" | "create";

function SampleArt({ night = false }: { night?: boolean }) {
  return <svg viewBox="0 0 600 360" role="img" aria-label={night ? "Sample illustration of a garden beneath a starry sky" : "Sample illustration of a sunny garden"}>
    <rect width="600" height="360" fill={night ? "#182642" : "#bce9ff"} />
    <circle cx="465" cy="78" r="38" fill={night ? "#fff9d8" : "#ffdc72"} />
    {night && <g fill="#fff9d8"><circle cx="80" cy="48" r="4"/><circle cx="210" cy="88" r="5"/><circle cx="330" cy="36" r="4"/></g>}
    <path d="M0 240Q140 145 290 240T600 220V360H0Z" fill={night ? "#34665b" : "#438866"}/>
    <path d="M0 310Q160 215 340 300T600 280V360H0Z" fill={night ? "#214c43" : "#245c48"}/>
    {[100, 190, 310, 400, 520].map((x, i) => <g key={x}><path d={`M${x} 335v-45`} stroke="#e0f1c4" strokeWidth="6"/><circle cx={x} cy={280 + (i % 2) * 12} r="17" fill={i % 2 ? "#ffcc73" : "#f6a6cb"}/><circle cx={x} cy={280 + (i % 2) * 12} r="6" fill="#522842"/></g>)}
  </svg>;
}

export function InteractiveDemo({ sample }: { sample: Sample }) {
  const [run, setRun] = useState(0);
  const reset = () => {
    localStorage.removeItem(DEMO_APPEARANCE_CACHE_KEY);
    applyAppearance(defaultAppearance);
    window.dispatchEvent(new CustomEvent(APPEARANCE_PREVIEW_EVENT, { detail: defaultAppearance }));
    setRun(value => value + 1);
  };
  return <DemoSession key={run} sample={sample} reset={reset} />;
}

function DemoSession({ sample, reset }: { sample: Sample; reset: () => void }) {
  const [view, setView] = useState<View>("return");
  const [person, setPerson] = useState<Person>("benny");
  const [arrived, setArrived] = useState<Person | null>(null);
  const [demoFronting, setDemoFronting] = useState<Person[]>(sample.presence.frontingPersonIds);
  const [reviewed, setReviewed] = useState(false);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [night, setNight] = useState(false);
  const [result, setResult] = useState<Picture | null>(null);
  const [message, setMessage] = useState("");
  const urls = useRef<string[]>([]);
  const nextId = useRef(1);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const name = (id: Person) => sample.people.find(p => p.id === id)!.name;
  const fronting = demoFronting;
  const changeView = (next: View) => { setView(next); setMessage(""); };
  const addPhoto = (file?: File) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setMessage("Choose a JPEG, PNG, or WebP photo smaller than 8 MB."); return;
    }
    const url = URL.createObjectURL(file);
    urls.current.push(url);
    setPictures(current => [...current, { id: nextId.current++, person, caption: file.name, url }]);
    setMessage(`Photo added to ${name(person)}’s demo gallery in this browser only.`);
  };
  return <main className={styles.demo}>
    <header className={styles.header}><Link className={styles.brand} href="/">Bunch</Link><span>Private demo</span><button onClick={reset}>Reset demo</button></header>
    <section className={styles.launcherHeading}><p className={styles.eyebrow}>Try Bunch · No sign-in needed</p><h1>What would help right now?</h1><p className={styles.intro}>Choose one demo activity for Fenton, Benny, and Dot.</p></section>
    <p className={styles.notice}>Fictional people and saved history. Your demo changes disappear when you reload or reset. Photos stay in this browser; image creation uses sample illustrations.</p>
    <nav className={styles.steps} aria-label="Demo experiences">
      <button aria-pressed={view === "return"} onClick={() => changeView("return")}><strong>Switch in</strong><span>Try an explicit arrival and catch-up.</span></button>
      <button aria-pressed={view === "photos"} onClick={() => changeView("photos")}><strong>Add a photo</strong><span>Preview it in a demo gallery.</span></button>
      <button aria-pressed={view === "create"} onClick={() => changeView("create")}><strong>Create an image</strong><span>Use prepared sample artwork.</span></button>
    </nav>
    <details className={styles.appearance}><summary>Change demo colors</summary><ThemeControl demo /></details>
    <div className={styles.people} aria-label="Meet the demo people">{sample.people.map(p => <details key={p.id}><summary>{p.name}</summary><p>{p.description}</p></details>)}</div>
    <label className={styles.person}>Try this as
      <select value={person} onChange={event => { setPerson(event.target.value as Person); setResult(null); setMessage(""); }}>{sample.people.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select>
    </label>
    {view === "return" && <section className={styles.panel} aria-labelledby="return-heading">
      <p className={styles.eyebrow}>A little context for your return</p><h2 id="return-heading">Switch in as {name(person)}</h2>
      <p><strong>Hosting responsibility:</strong> {name(sample.presence.hostingPersonId)}<br/><strong>Fronting in this demo:</strong> {fronting.map(name).join(", ")}</p>
      <p>Choose to record a sample arrival. Other people remain fronting, and hosting responsibility stays separate.</p>
      <button className={styles.primary} onClick={() => { setArrived(person); setDemoFronting(current => [...new Set([...current, person])]); setReviewed(false); setMessage(`Sample arrival recorded for ${name(person)}. Catch-up is ready below.`); }}>Try switching in as {name(person)}</button>
      {arrived && <div className={styles.catchup}>
        <h3>Catch-up for {name(arrived)}</h3>
        {arrived === "benny" ? <><p>{sample.catchUp.overview}</p><p className={styles.small}>Sample window: September 8–9, 2026. Saved records only; this does not establish anyone’s absence.</p></> : <p>Here are the fictional saved records relevant to {name(arrived)}. This walkthrough has no recorded catch-up window for {name(arrived)}.</p>}
        {sample.notes.filter(note => note.relevantTo.includes(arrived)).map(note => <article key={note.id}><p><strong>From {name(note.author)}</strong> · Relevant to: {note.relevantTo.map(name).join(", ")}</p><p>{note.body}</p></article>)}
        {sample.tasks.filter(task => task.relevantTo.includes(arrived)).map(task => <article key={task.id}><h4>{task.title}</h4><p>Relevant to: {task.relevantTo.map(name).join(", ")} · {task.status === "OPEN" ? "Open" : "Done"}</p></article>)}
        {arrived === "dot" ? <p>No sample notes or tasks are assigned relevance to Dot. That says nothing about Dot’s presence.</p> : <><button disabled={reviewed} onClick={() => { setReviewed(true); setMessage("Marked as read in the demo. The thank-you task is still open."); }}>{reviewed ? "Read ✓" : "Mark catch-up as read"}</button><p className={styles.small}>Reading a catch-up does not complete its tasks.</p></>}
      </div>}
    </section>}
    {view === "photos" && <section className={styles.panel} aria-labelledby="photos-heading"><h2 id="photos-heading">Add a photo for {name(person)}</h2><p>Try choosing a picture for a person’s gallery. Your file is previewed here and is never uploaded.</p><label className={styles.upload}>Choose a photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { addPhoto(event.target.files?.[0]); event.target.value = ""; }} /></label><p className={styles.small}>JPEG, PNG, or WebP · Up to 8 MB</p></section>}
    {view === "create" && <section className={styles.panel} aria-labelledby="create-heading"><h2 id="create-heading">Create an image for {name(person)}</h2><p>Explore the steps: choose an idea, preview the result, then keep it in a gallery. This uses prepared sample art, not live AI generation.</p>
      <form onSubmit={event => { event.preventDefault(); setResult({ id: nextId.current++, person, caption: night ? "A garden under a starry sky" : "A peaceful sunny garden", night }); setMessage("Sample image ready to review. It has not been added to the gallery."); }}>
        <label>Choose an image idea<select value={night ? "night" : "day"} onChange={event => { setNight(event.target.value === "night"); setResult(null); }}><option value="day">A peaceful sunny garden</option><option value="night">A garden under a starry sky</option></select></label>
        <button className={styles.primary} type="submit">Generate sample image</button>
      </form>
      {result && <figure className={styles.result}><SampleArt night={result.night}/><figcaption>{result.caption} · Sample illustration for {name(result.person)}</figcaption><button onClick={() => { setPictures(current => [...current, result]); setResult(null); setMessage("Sample image added to the demo gallery."); }}>Keep in demo gallery</button></figure>}
    </section>}
    <p role="status" className={styles.status}>{message}</p>
    <section className={styles.gallery} aria-labelledby="gallery-heading"><h2 id="gallery-heading">{name(person)}’s demo gallery</h2>{pictures.filter(p => p.person === person).length === 0 ? <p>No pictures yet. Add a photo or create a sample image.</p> : <div className={styles.grid}>{pictures.filter(p => p.person === person).map(p => <figure key={p.id}>{p.url ? <img src={p.url} alt={`Local photo preview for ${name(p.person)}`} onError={() => { setPictures(current => current.filter(item => item.id !== p.id)); setMessage("That file could not be displayed. Please choose another photo."); }} /> : <SampleArt night={p.night}/>}<figcaption>{p.caption}</figcaption><button onClick={() => { if (p.url) URL.revokeObjectURL(p.url); setPictures(current => current.filter(item => item.id !== p.id)); setMessage("Picture removed from the demo gallery."); }}>Remove picture</button></figure>)}</div>}</section>
    <footer className={styles.footer}><p>Want a place for your own system?</p><Link href="/auth/login?returnTo=%2Fhome">Sign in to Bunch →</Link><p className={styles.small}>Demo changes and photos do not transfer to an account.</p></footer>
  </main>;
}
