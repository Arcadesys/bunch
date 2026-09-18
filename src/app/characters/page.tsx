import type { Metadata } from "next";
import { CharacterContextHelper } from "./character-context-helper";
import styles from "./characters.module.css";

export const metadata: Metadata = {
  title: "Character continuity helper — Bunch",
  description: "A lightweight Bunch surface for keeping fictional characters consistent in AI-assisted writing workflows.",
};

export default function CharactersPage() {
  return (
    <main className={styles.page}>
      <a className={styles.skip} href="#helper">Skip to helper</a>
      <header className={styles.header}>
        <a href="/" className={styles.brand}>Bunch<span aria-hidden="true">.</span></a>
        <p>Same continuity problem. Different surface.</p>
      </header>
      <section className={styles.hero} aria-labelledby="characters-heading">
        <p className={styles.eyebrow}>Bunch / Characters</p>
        <h1 id="characters-heading">Keep a character consistent without dragging the whole manuscript into every prompt.</h1>
        <p className={styles.intro}>
          Capture the small set of truths your harness actually needs: core canon, voice,
          recent developments, and the things that must not silently drift.
        </p>
        <p className={styles.privacy}>No account. No upload. This helper stays in your browser.</p>
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
