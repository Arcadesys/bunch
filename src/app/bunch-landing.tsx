import "./landing.css";
const signIn = "/auth/login";

export function BunchLanding() {
  return (
    <div className="bunch-landing">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="header wrap">
        <a className="brand" href="#" aria-label="Bunch home">
          bunch<span aria-hidden="true">.</span>
        </a>
        <nav aria-label="Main navigation">
          <a className="about-link" href="#what-it-does">
            What Bunch does
          </a>
          <a className="button sign-in" href={signIn}>
            Sign in <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main id="main">
        <section className="hero wrap" aria-labelledby="headline">
          <div className="hero-copy">
            <p className="eyebrow">A personal companion for life with DID</p>
            <h1 id="headline">
              A shared life.
              <br />A little more <em>continuity.</em>
            </h1>
            <p className="intro">
              Keep the people, notes, pictures, and loose ends of your system in one place. Bunch
              helps you pick up the thread when you come back.
            </p>
            <a className="text-link" href="#what-it-does">
              Meet Bunch <span aria-hidden="true">↓</span>
            </a>
          </div>
          <figure className="hero-photo">
            <img
              src="/landing/bunch-group.jpg"
              alt="Eight members of the Arcades, pictured as distinct illustrated characters, together on a sunny beach."
              width="1280"
              height="958"
              fetchPriority="high"
            />
            <figcaption>
              <span>The Arcades, together.</span>
              <span>A group photo made with our character references.</span>
            </figcaption>
          </figure>
        </section>
        <section className="features wrap" id="what-it-does" aria-labelledby="features-title">
          <div className="section-heading">
            <p className="eyebrow">Less reconstructing. More living.</p>
            <h2 id="features-title">
              Somewhere to leave
              <br />
              the thread.
            </h2>
            <p>
              A note for later. A task still in motion. Something someone needs to know. Bunch keeps
              those pieces available for your next return.
            </p>
          </div>
          <div className="feature-list">
            <article>
              <span className="number">01</span>
              <div>
                <h3>Come back with context</h3>
                <p>
                  Review notes, tasks, decisions, and saved conversation summaries in a catch-up
                  tied to your recorded return.
                </p>
              </div>
            </article>
            <article>
              <span className="number">02</span>
              <div>
                <h3>Keep the everyday things</h3>
                <p>
                  Save a thought, remember where something went, and keep track of what still needs
                  doing.
                </p>
              </div>
            </article>
            <article>
              <span className="number">03</span>
              <div>
                <h3>Record who’s here, explicitly</h3>
                <p>
                  Hosting responsibility and fronting presence have separate records. People can
                  front together. You tell Bunch what to record.
                </p>
              </div>
            </article>
          </div>
        </section>
        <section className="people" aria-labelledby="people-title">
          <div className="wrap people-inner">
            <div className="portrait-pair">
              <figure>
                <img
                  src="/landing/addie.jpg"
                  alt="Addie’s illustrated portrait: patterned sweater, glasses, and dark hair with a pink streak."
                  width="640"
                  height="640"
                  loading="lazy"
                />
                <figcaption>Addie</figcaption>
              </figure>
              <figure>
                <img
                  src="/landing/lucy.png"
                  alt="Lucy’s illustrated portrait: tufted ears, spotted fur, purple glasses, and a green dress."
                  width="1254"
                  height="1254"
                  loading="lazy"
                />
                <figcaption>Lucy</figcaption>
              </figure>
            </div>
            <div className="people-copy">
              <p className="eyebrow">People, with room to be themselves</p>
              <h2>
                More than a<br />
                name in a list.
              </h2>
              <p>
                Give each person a profile, a picture, and visual references. Keep generated artwork
                in your image library, with the people it belongs to.
              </p>
              <p>These are some of ours. The pictures help make our shared life visible.</p>
            </div>
          </div>
        </section>
        <section className="closing wrap">
          <p className="eyebrow">Built from lived experience</p>
          <h2>
            A companion for
            <br />
            our kind of everyday.
          </h2>
          <p>
            Bunch grew out of living with DID and needing a way to carry context across the day. It
            brings practical records and personal pictures together, in a private space.
          </p>
          <a className="button" href={signIn}>
            Sign in to Bunch <span aria-hidden="true">↗</span>
          </a>
          <p className="access-note">For people with existing Bunch access.</p>
        </section>
      </main>
      <footer className="wrap footer">
        <a className="brand" href="#">
          bunch<span aria-hidden="true">.</span>
        </a>
        <p>Your people. Your context. Your pace.</p>
      </footer>
    </div>
  );
}
