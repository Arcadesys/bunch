"use client";

import { useMemo, useState } from "react";
import styles from "./characters.module.css";

const seed = {
  name: "Valerie",
  appearance: "",
  canon: "White cat. Investigative reporter. Protective of Clover. Avoids admitting when she is frightened.",
  voice: "Dry, precise, observant. Short sentences under stress. Rarely uses profanity.",
  recent: "She has learned the archive was altered, but she has not yet discovered who changed it.",
  constraints: "Do not make her omniscient. Do not reveal the archive culprit. She calls Fenton “Fox.”",
};

function normalize(value: string) {
  return value.trim() || "Not specified.";
}

export function CharacterContextHelper() {
  const [name, setName] = useState(seed.name);
  const [appearance, setAppearance] = useState(seed.appearance);
  const [canon, setCanon] = useState(seed.canon);
  const [voice, setVoice] = useState(seed.voice);
  const [recent, setRecent] = useState(seed.recent);
  const [constraints, setConstraints] = useState(seed.constraints);
  const [status, setStatus] = useState("");

  const packet = useMemo(() => {
    const displayName = normalize(name);
    return [
      `# Character context: ${displayName}`,
      "",
      "## Visual identity",
      normalize(appearance),
      "",
      "## Core canon",
      normalize(canon),
      "",
      "## Voice and behavior",
      normalize(voice),
      "",
      "## Recent developments",
      normalize(recent),
      "",
      "## Continuity constraints",
      normalize(constraints),
      "",
      "Use only the context above as established character truth. If a requested detail conflicts with it or is missing, flag the conflict or uncertainty instead of inventing canon.",
      "For image work, use the approved reference image supplied separately alongside this packet. If no image is attached, do not claim to have seen one. Preserve the specified visual anchors and ask before changing them.",
    ].join("\n");
  }, [name, appearance, canon, voice, recent, constraints]);

  async function copyPacket() {
    try {
      await navigator.clipboard.writeText(packet);
      setStatus("Copied. Paste the packet into your harness or project instructions. Reference images must be attached separately.");
    } catch {
      setStatus("Copy was blocked by the browser. Select the packet below and copy it manually.");
    }
  }

  function reset() {
    setName(seed.name);
    setAppearance(seed.appearance);
    setCanon(seed.canon);
    setVoice(seed.voice);
    setRecent(seed.recent);
    setConstraints(seed.constraints);
    setStatus("Example restored.");
  }

  return (
    <section className={styles.helper} id="helper" aria-labelledby="helper-heading">
      <div className={styles.helperIntro}>
        <p className={styles.eyebrow}>Build a context packet</p>
        <h2 id="helper-heading">One character. A portable reference.</h2>
        <p>
          Record appearance, canon, voice, recent developments, and what must not change.
          Copy the packet into your AI harness or project instructions. For image work, attach
          your chosen reference image there too. This helper copies text; it does not generate or upload images.
        </p>
      </div>

      <div className={styles.workspace}>
        <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
          <label>
            Character name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label>
            Appearance and visual anchors
            <textarea
              rows={4}
              value={appearance}
              onChange={(event) => setAppearance(event.target.value)}
              aria-describedby="appearance-help"
              placeholder="Species, markings, palette, silhouette, glasses, signature accessories, and what must stay recognizable."
            />
          </label>
          <p className={styles.fieldHint} id="appearance-help">
            Separate permanent features from scene-specific choices. Leave unknown details unspecified.
            Images above are examples; they are not automatically attached to your packet.
          </p>

          <label>
            Core canon
            <textarea rows={5} value={canon} onChange={(event) => setCanon(event.target.value)} />
          </label>

          <label>
            Voice and behavior
            <textarea rows={5} value={voice} onChange={(event) => setVoice(event.target.value)} />
          </label>

          <label>
            Recent developments
            <textarea rows={5} value={recent} onChange={(event) => setRecent(event.target.value)} />
          </label>

          <label>
            Continuity constraints
            <textarea rows={5} value={constraints} onChange={(event) => setConstraints(event.target.value)} />
          </label>

          <div className={styles.actions}>
            <button type="button" onClick={copyPacket}>Copy harness packet</button>
            <button type="button" className={styles.secondary} onClick={reset}>Reset example</button>
          </div>
          <p className={styles.status} role="status" aria-live="polite">{status}</p>
        </form>

        <aside className={styles.output} aria-labelledby="packet-heading">
          <div className={styles.outputHeader}>
            <p className={styles.eyebrow}>Generated output</p>
            <h3 id="packet-heading">Harness packet</h3>
          </div>
          <pre tabIndex={0}>{packet}</pre>
        </aside>
      </div>
    </section>
  );
}
