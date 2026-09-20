"use client";

import { useMemo, useState } from "react";
import styles from "./characters.module.css";

const seed = {
  name: "Valerie",
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
    ].join("\n");
  }, [name, canon, voice, recent, constraints]);

  async function copyPacket() {
    try {
      await navigator.clipboard.writeText(packet);
      setStatus("Copied. Paste the packet into your harness or project instructions.");
    } catch {
      setStatus("Copy was blocked by the browser. Select the packet below and copy it manually.");
    }
  }

  function reset() {
    setName(seed.name);
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
        <h2 id="helper-heading">One character. Four kinds of truth.</h2>
        <p>
          Edit the example, then copy the compact packet into an AI harness, system prompt,
          or project instruction.
        </p>
      </div>

      <div className={styles.workspace}>
        <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
          <label>
            Character name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>

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
