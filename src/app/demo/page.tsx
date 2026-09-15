import { notFound } from "next/navigation";
import { fictionalDemoEnabled, getFictionalDemo } from "@/server/fictional-demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo system — Bunch" };

export default function DemoPage() {
  if (!fictionalDemoEnabled()) notFound();
  const demo = getFictionalDemo();
  return <main style={{ maxWidth: "52rem", margin: "0 auto", padding: "1.5rem", lineHeight: 1.6 }}>
    <h1>{demo.systemName}</h1>
    <p>Fictional, read-only Bunch walkthrough. All people and sample content here are made up.</p>
    <p><a href="#sample-content">Explore the sample notes and task ↓</a></p>
    <section aria-label="People">
      {demo.people.map(person => <article key={person.id} style={{ border: "2px solid var(--line)", padding: "1rem", marginBlock: "1rem" }}><h2>{person.name}</h2><p>{person.description}</p></article>)}
    </section>
    <section aria-label="Hosting and fronting">
      <h2>Hosting and fronting</h2>
      <p><strong>Hosting responsibility:</strong> {demo.hosting.name}</p>
      <p><strong>Fronting presence:</strong> {demo.fronting.map(person => person.name).join(", ")}</p>
      <p>These are separate fictional records. Neither implies the other.</p>
    </section>
    <section id="sample-content" tabIndex={-1}>
      <h2>Sample notes and task</h2>
      {demo.notes.map(note => <article key={note.title}><h3>{note.title}</h3><p>From {note.from} · Relevant to: {note.relevantTo.join(", ")}</p><p>{note.body}</p></article>)}
      {demo.tasks.map(task => <article key={task.title}><h3>{task.title} — {task.status}</h3><p>Relevant to: {task.relevantTo.join(", ")}</p><p>{task.detail}</p></article>)}
    </section>
    <p>Try the Bunch Demo plugin: “Show Demo system, then explain who the picnic task is relevant to.”</p>
  </main>;
}
