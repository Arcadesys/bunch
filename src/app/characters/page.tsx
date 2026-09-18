import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import addiePortrait from "../../../public/landing/addie.jpg";
import groupScene from "../../../public/landing/bunch-group.jpg";
import lucyPortrait from "../../../public/landing/lucy.png";
import tallyPortrait from "../../../public/landing/tally-portrait.png";
import { CharacterContextHelper } from "./character-context-helper";
import styles from "./characters.module.css";

export const metadata: Metadata = {
  title: "Character continuity helper — Bunch",
  description: "Keep a character recognizable across scenes: visual references, appearance, voice, and canon in a compact context packet for your AI workflow.",
};

// Deliberately reuse artwork already published with Bunch. Never fetch private
// profiles, signed gallery URLs, or reference credentials on this public route.
const references = [
  {
    name: "Tally Arcade",
    image: tallyPortrait,
    original: "/landing/tally-portrait.png",
    alt: "Tally Arcade’s illustrated fox-spirit portrait.",
    label: "Keep the identity",
    detail: "A chosen face and silhouette. The setting can change without redesigning the character.",
  },
  {
    name: "Lucy Arcade",
    image: lucyPortrait,
    original: "/landing/lucy.png",
    alt: "Lucy Arcade’s illustrated portrait, with tufted ears, spotted fur, purple glasses, and a green dress.",
    label: "Keep the details",
    detail: "Tufted ears, spotted fur, purple glasses. Record the visual anchors that should not drift.",
  },
  {
    name: "Addie Arcade",
    image: addiePortrait,
    original: "/landing/addie.jpg",
    alt: "Addie Arcade’s illustrated portrait, with a patterned sweater, glasses, and dark hair with a pink streak.",
    label: "Keep the signature",
    detail: "Glasses and that pink streak. Decide what stays recognizable and what a new scene may change.",
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

      <section className={styles.hero} aria-labelledby="characters-heading">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Bunch / Characters</p>
          <h1 id="characters-heading">Make this character.<br /><span>Every time.</span></h1>
          <p className={styles.intro}>
            A familiar face. A particular voice. The details that make them yours.
            Carry those references into the next scene instead of starting from scratch.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryLink} href="#helper">Build a character packet <span aria-hidden="true">↓</span></a>
            <a className={styles.textLink} href="#references">Explore the references</a>
          </div>
          <p className={styles.privacy}>No account. No upload. Your edits stay in this browser.</p>
        </div>
        <figure className={styles.heroArtwork}>
          <a
            className={styles.artworkLink}
            href="/landing/bunch-group.jpg"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the Arcades group artwork at full size (opens in a new tab)"
          >
            <Image
              src={groupScene}
              alt="The Arcades’ distinct illustrated characters together on a sunny beach."
              className={styles.sceneImage}
              sizes="(max-width: 800px) 100vw, (max-width: 1280px) 50vw, 580px"
              loading="eager"
              fetchPriority="high"
            />
          </a>
          <figcaption className={styles.sceneCaption}>
            <span><strong>The Arcades, together.</strong> An existing scene from our image library.</span>
            <span className={styles.enlargeHint} aria-hidden="true">View full size ↗</span>
          </figcaption>
        </figure>
      </section>

      <section className={styles.references} id="references" aria-labelledby="references-heading">
        <div className={styles.referenceHeading}>
          <p className={styles.eyebrow}>Start with someone recognizable</p>
          <h2 id="references-heading">Not just a name in a prompt.</h2>
          <p>
            Choose a reference you love. Name the features that matter. Then separate the
            things that can change—pose, outfit, setting—from the things that make this character this character.
          </p>
        </div>
        <div className={styles.referenceGrid}>
          {references.map((reference) => (
            <figure className={styles.referenceCard} key={reference.name}>
              <a
                className={styles.referenceImageLink}
                href={reference.original}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${reference.name}’s full-size reference (opens in a new tab)`}
              >
                <Image
                  src={reference.image}
                  alt={reference.alt}
                  className={styles.referenceImage}
                  sizes="(max-width: 600px) 100vw, (max-width: 1280px) 33vw, 370px"
                  loading="lazy"
                />
                <span className={styles.imageHint} aria-hidden="true">View reference ↗</span>
              </a>
              <figcaption className={styles.referenceCaption}>
                <p className={styles.eyebrow}>{reference.label}</p>
                <h3>{reference.name}</h3>
                <p>{reference.detail}</p>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className={styles.galleryNote}>
          Existing AI-generated artwork from the Arcades’ collection. These are visual reference
          examples, not a consistency benchmark or images generated by this page.
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
          hoping a model remembers correctly. A reference is a starting point, not a guarantee;
          review each result against the character you meant to make.
        </p>
      </section>
    </main>
  );
}
