import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CharacterContextHelper } from "./character-context-helper";
import styles from "./characters.module.css";

export const metadata: Metadata = {
  title: "Character continuity helper | Bunch",
  description: "A lightweight Bunch surface for keeping fictional characters consistent in AI-assisted writing and image prompts.",
};

const examples = [
  {
    src: "/landing/lucy.png",
    alt: "Generated character artwork of Lucy Arcade.",
    title: "An individual character",
    caption: "Keep a visual reference alongside the details that make this character recognizable.",
  },
  {
    src: "/landing/bunch-beach.png",
    alt: "Eight members of the Arcades together on a sunny beach, with colorful kites behind them.",
    title: "A whole cast",
    caption: "Carry each character's identity into a shared scene, rather than starting from scratch.",
  },
];

export default function CharactersPage() {
  return (
    <main className={styles.page}>
      <a className={styles.skip} href="#helper">Skip to helper</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>Bunch<span aria-hidden="true">.</span></Link>
        <p>Same continuity problem. Different surface.</p>
      </header>
      <section
        className={styles.hero}
        aria-labelledby="characters-heading"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 21rem), 1fr))", gap: "clamp(1.5rem, 4vw, 3rem)", alignItems: "center" }}
      >
        <div>
          <p className={styles.eyebrow}>Bunch / Characters</p>
          <h1 id="characters-heading">Make this character. Every time.</h1>
          <p className={styles.intro}>
            Keep a character consistent without dragging the whole manuscript into every prompt.
            Capture core canon, visual traits, voice, recent developments, and the things that must not silently drift.
          </p>
          <p className={styles.privacy}>No account. No upload. This helper stays in your browser.</p>
        </div>
        <figure style={{ margin: 0, minWidth: 0 }}>
          <a
            href="/landing/tally-portrait.png"
            aria-label="View Tally Arcade's full portrait"
            style={{ position: "relative", display: "block", aspectRatio: "4 / 5", overflow: "hidden", borderRadius: "1rem", background: "var(--surface)", border: "1px solid var(--line)" }}
          >
            <Image
              src="/landing/tally-portrait.png"
              alt="Tally Arcade's illustrated portrait: an orange fox with silver hair, teal eyes, and a star-patterned cloak."
              fill
              preload
              sizes="(max-width: 800px) 92vw, (max-width: 1300px) 46vw, 552px"
              style={{ objectFit: "contain" }}
            />
          </a>
          <figcaption style={{ marginTop: ".8rem", color: "var(--muted)", lineHeight: 1.6 }}>
            Tally Arcade. A visual reference to return to, not reinvent.
          </figcaption>
        </figure>
      </section>
      <section aria-labelledby="examples-heading" style={{ maxWidth: "72rem", margin: "0 auto 3rem" }}>
        <p className={styles.eyebrow}>Character references in practice</p>
        <h2 id="examples-heading" style={{ margin: "0 0 1.5rem", fontSize: "clamp(1.8rem, 4vw, 2.8rem)", lineHeight: 1.15 }}>A face. A cast. A world.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 21rem), 1fr))", gap: "1.5rem" }}>
          {examples.map((example) => (
            <figure key={example.src} style={{ margin: 0, minWidth: 0 }}>
              <a
                href={example.src}
                aria-label={`View full artwork: ${example.title}`}
                style={{ position: "relative", display: "block", aspectRatio: "4 / 3", overflow: "hidden", borderRadius: "1rem", background: "var(--surface)", border: "1px solid var(--line)" }}
              >
                <Image
                  src={example.src}
                  alt={example.alt}
                  fill
                  sizes="(max-width: 800px) 92vw, (max-width: 1300px) 46vw, 564px"
                  style={{ objectFit: "contain" }}
                />
              </a>
              <figcaption style={{ marginTop: "1rem", lineHeight: 1.6 }}>
                <strong>{example.title}</strong>
                <p style={{ margin: ".35rem 0 0", color: "var(--muted)" }}>{example.caption}</p>
              </figcaption>
            </figure>
          ))}
        </div>
        <p style={{ color: "var(--muted)", lineHeight: 1.7, marginTop: "1.5rem" }}>
          Existing generated artwork from the Arcades. The helper below creates a text context packet for your workflow; it does not generate images.
        </p>
      </section>
      <CharacterContextHelper />
      <section className={styles.explainer} aria-labelledby="why-heading">
        <p className={styles.eyebrow}>Why this exists</p>
        <h2 id="why-heading">The engine is continuity, not the original interface.</h2>
        <p>
          Bunch began as software for recovering context across memory gaps. Character work exposes
          the same product primitive from another direction: preserve canonical facts, track what
          changed, and hand an AI system the smallest useful packet of context at the moment it needs it.
        </p>
        <p>
          Different audience, vocabulary, and onboarding. Same discipline: explicit records beat
          hoping a model remembers correctly.
        </p>
      </section>
    </main>
  );
}
