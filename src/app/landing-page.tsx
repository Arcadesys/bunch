import Image from "next/image";
import Link from "next/link";
import beach from "../../public/landing/bunch-beach.png";
import tally from "../../public/landing/tally-portrait.png";
import styles from "./landing-page.module.css";

const signInHref = "/auth/login?returnTo=%2Fhome";

export function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Bunch home">
          <Image src="/bunch-barrel-monkeys.png" width={52} height={52} alt="" />
          <span>Bunch<span className={styles.brandDot}>.</span></span>
        </Link>
        <nav aria-label="Main navigation" className={styles.navigation}>
          <a className={styles.explore} href="#how-it-helps">Meet Bunch</a>
          <a className={styles.signIn} href={signInHref}>Sign in <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="welcome">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>A private companion for life with DID</p>
            <h1 id="welcome">A little more<br />continuity.<br /><em>A place for<br className={styles.desktopBreak} /> all of you.</em></h1>
            <p className={styles.intro}>Keep the notes, people, and everyday context that help your system pick up the thread.</p>
            <a className={styles.primary} href="#how-it-helps">Get to know Bunch <span aria-hidden="true">↓</span></a>
            <p className={styles.small}>Built from lived experience. On your terms.</p>
          </div>
          <figure className={styles.heroArt}>
            <Image src={beach} alt="Eight members of the Arcades system together on a sunny beach, with colorful kites behind them." preload sizes="(max-width: 900px) 100vw, 62vw" />
            <figcaption><span className={styles.captionMark} aria-hidden="true">✳</span> The Arcades, together. A Bunch group portrait.</figcaption>
          </figure>
        </section>

        <section id="how-it-helps" className={styles.features} aria-labelledby="helps-heading">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>Less piecing things together</p>
            <h2 id="helps-heading">Somewhere to leave the thread.<br />Somewhere to find it again.</h2>
            <p>Bunch holds the context you choose to save, so returning doesn’t have to mean starting from scratch.</p>
          </div>
          <div className={styles.featureGrid}>
            <article><span className={styles.number}>01 / REMEMBER</span><h3>Leave something for later.</h3><p>Save notes, todos, decisions, and conversation links and summaries. Keep the next step alongside the context.</p></article>
            <article><span className={styles.number}>02 / RETURN</span><h3>Catch up at your pace.</h3><p>When you explicitly record a return, review saved changes for that window. Mark what you’ve read, or narrow your view to one next step.</p></article>
            <article><span className={styles.number}>03 / CONNECT</span><h3>Keep the distinctions that matter.</h3><p>Record hosting responsibility and fronting presence separately. You say who’s here and what changed; Bunch keeps the records.</p></article>
          </div>
        </section>

        <section className={styles.portraitSection} aria-labelledby="people-heading">
          <figure className={styles.portrait}>
            <Image src={tally} alt="Tally Arcade’s illustrated portrait: an orange fox with silver hair, teal eyes, and a star-patterned cloak." sizes="(max-width: 700px) 100vw, 42vw" />
            <figcaption>Tally Arcade · a portrait made for her</figcaption>
          </figure>
          <div className={styles.portraitCopy}>
            <p className={styles.eyebrow}>People, with room to be themselves</p>
            <h2 id="people-heading">More than a<br /><em>name in a list.</em></h2>
            <p>Give each person a profile, their own words, and pictures that feel like them. Keep portraits and appearance references together, and arrange people in a group-photo scene.</p>
            <p>These are pictures of our system. Your Bunch can reflect yours.</p>
            <div className={styles.pullquote}>“Oh, that’s me.”<span>Sometimes a picture is the way back to yourself.</span></div>
          </div>
        </section>

        <section className={styles.trust} aria-labelledby="terms-heading">
          <p className={styles.eyebrow}>Your context. Your say.</p>
          <h2 id="terms-heading">A companion you can come back to.</h2>
          <div className={styles.trustGrid}>
            <div><h3>Private records</h3><p>Your notes and pictures sit behind sign-in. Gallery sharing is an explicit choice.</p></div>
            <div><h3>Explicit arrivals</h3><p>Opening Bunch doesn’t announce who’s fronting. Presence changes are yours to record.</p></div>
            <div><h3>Honest catch-ups</h3><p>Catch-ups use saved records. Missing conversation summaries mean missing context, not that nothing happened.</p></div>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-heading">
          <Image src="/bunch-barrel-monkeys.png" width={100} height={100} alt="" />
          <p className={styles.eyebrow}>A place to pick up the thread</p>
          <h2 id="closing-heading">Welcome back to your Bunch.</h2>
          <p>Already have access? Your saved context is waiting.</p>
          <a className={styles.primary} href={signInHref}>Sign in to Bunch <span aria-hidden="true">↗</span></a>
        </section>
      </main>
      <footer className={styles.footer}><span>Bunch · Built by the Arcades</span><a href="#welcome">Back to the top ↑</a></footer>
    </div>
  );
}
