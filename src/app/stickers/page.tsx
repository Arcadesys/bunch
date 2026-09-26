"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { AppNavigation } from "@/app/app-navigation";
import { ListDetail, useListSelection, initials, type ListRow } from "@/app/list-detail";
import { defaultStickerPack, stickerPackCsv, type StickerPackDraft } from "@/domain/sticker-pack";
import "./stickers.css";

type Person = {
  id: string; name: string; description?: string | null; pronouns?: string | null;
  appearanceNotes?: string | null; appearanceReferenceImageIds?: string[];
  profilePicture?: { id: string } | null;
};
const demoHeaders = { "x-system-demo": "local" };

export default function StickerLabPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [pack, setPack] = useState<StickerPackDraft | null>(null);
  const [notice, setNotice] = useState("Choose a person. Bunch will keep the ten reaction directions private with their profile.");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/alters?limit=100", { headers: demoHeaders }).then(r => r.json()).then(payload => {
      const list = Array.isArray(payload.data) ? payload.data as Person[] : [];
      setPeople(list);
    }).catch(() => setNotice("Could not load private people.")).finally(() => setLoaded(true));
  }, []);

  // Until people load, an empty list keeps a saved ?id= from being replaced.
  const ids = useMemo(() => loaded ? people.map(p => p.id) : [], [loaded, people]);
  const [selectedId, select] = useListSelection(ids);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void fetch(`/api/v1/preferences/stickers/${encodeURIComponent(selectedId)}`, { headers: demoHeaders, cache: "no-store" }).then(async r => {
      const payload = await r.json();
      if (!r.ok) throw new Error(payload?.error?.message || "Could not load sticker directions.");
      if (!active) return;
      setPack(payload.data as StickerPackDraft);
      setNotice("Shape how this person actually says each thing. These are performances, not fixed emoji poses.");
    }).catch(() => { if (active) setPack(defaultStickerPack(selectedId)); });
    return () => { active = false; };
  }, [selectedId]);

  const person = people.find(p => p.id === selectedId);
  // Never show (or save) one person's board under another person's name while switching.
  const board = pack && pack.alterId === selectedId ? pack : null;
  const completed = useMemo(() => pack ? pack.stickers.filter(s => s.performance.trim()).length : 0, [pack]);

  function updateSticker(index: number, field: string, value: string) {
    if (!pack) return;
    setPack({ ...pack, stickers: pack.stickers.map((s, i) => i === index ? { ...s, [field]: value } : s) });
  }

  async function save() {
    if (!pack) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/preferences/stickers/${encodeURIComponent(pack.alterId)}`, {
        method: "PUT", headers: { ...demoHeaders, "Content-Type": "application/json" }, body: JSON.stringify(pack)
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || "Could not save sticker directions.");
      setNotice("Sticker directions saved privately in Bunch.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save sticker directions."); }
    finally { setSaving(false); }
  }

  async function copyCsv() {
    if (!pack) return;
    await navigator.clipboard.writeText(stickerPackCsv(pack));
    setNotice("Copied the ten-sticker CSV. Hand this to the sticker generator for blocking.");
  }

  async function copyPrompt() {
    if (!pack || !person) return;
    const prompt = `Make a personalized ten-reaction sticker pack for ${person.name}. Use Bunch for their canonical appearance references. Start from this approved direction board, do a cheap blocking pass first, and repair only the selected sticker when I ask for changes. Do not render final character art until the blocking poses are approved.\n\nPersonality summary:\n${pack.personalitySummary || "(not written yet)"}\n\nCSV:\n${stickerPackCsv(pack)}`;
    await navigator.clipboard.writeText(prompt);
    setNotice("Copied a ChatGPT handoff prompt with the full reaction board.");
  }

  // Build list rows
  const rows: ListRow[] = useMemo(() => {
    return people.map(p => ({
      id: p.id,
      avatar: { src: p.profilePicture?.id ? `/api/v1/images/${encodeURIComponent(p.profilePicture.id)}` : null, initials: initials(p.name) },
      title: p.name,
      meta: p.appearanceReferenceImageIds?.length ? "Appearance reference ready" : "No appearance reference yet",
    }));
  }, [people]);

  return <main className="app-page">
    <AppNavigation current="STICKERS" />
    <ListDetail
      title="Sticker lab"
      count="Ten reactions each"
      intro="Direct ten tiny performances for one person, then hand them to ChatGPT for blocking and character rendering."
      rows={rows}
      selectedId={person ? selectedId : null}
      onSelect={select}
      detailLabel="Reaction board"
      listStatus={<>
        {person ? null : <p className="ld-intro" role="status">{notice}</p>}
        {loaded && people.length === 0 ? <p className="ld-intro">No private people yet. Add them in People first.</p> : null}
      </>}
    >
      {person ? (
        <div className="detail-card sticker-lab-detail">
          <p className="notice" role="status">{notice}</p>
          <div className="sticker-person-detail">
            {person.profilePicture?.id && <Image src={`/api/v1/images/${encodeURIComponent(person.profilePicture.id)}`} alt={`${person.name} profile picture`} width={180} height={180} unoptimized />}
            <div>
              <h2>{person.name}’s reactions</h2>
              <p>{person.description || "No description recorded."}</p>
              <p>{person.appearanceReferenceImageIds?.length ? `${person.appearanceReferenceImageIds.length} selected appearance reference(s) ready.` : "No selected appearance reference yet."}</p>
            </div>
          </div>
          {board ? <>

          <div className="sticker-progress">
            <strong>{completed}/10 performances directed</strong>
            <span>Appearance comes later. Get the acting right first.</span>
          </div>

          <label>
            Personality / communication summary
            <textarea rows={3} value={board.personalitySummary} onChange={e => setPack({ ...board, personalitySummary: e.target.value })} placeholder="Deadpan, affectionate, signs thank-you, hates exaggerated apology poses..." />
          </label>
          <label>
            Pack-wide notes
            <textarea rows={3} value={board.notes} onChange={e => setPack({ ...board, notes: e.target.value })} placeholder="No captions except congrats. Keep hands readable. Tail carries a lot of emotion." />
          </label>

          <section className="sticker-board" aria-label="Ten reaction directions">
            {board.stickers.map((s, index) => <article className="sticker-card" key={s.id}>
              <header><span className="sticker-emoji" aria-hidden="true">{s.emoji}</span><div><h3>{s.intent}</h3><small>{s.id}</small></div></header>
              <label>Performance<textarea rows={2} value={s.performance} onChange={e => updateSticker(index, "performance", e.target.value)} placeholder="What does this person actually do?" /></label>
              <div className="sticker-fields">
                <label>Expression<input value={s.expression} onChange={e => updateSticker(index, "expression", e.target.value)} /></label>
                <label>Gesture<input value={s.gesture} onChange={e => updateSticker(index, "gesture", e.target.value)} /></label>
                <label>Framing<select value={s.framing} onChange={e => updateSticker(index, "framing", e.target.value)}><option>face</option><option>chest-up</option><option>waist-up</option><option>full-body</option></select></label>
                <label>Intensity<select value={s.intensity} onChange={e => updateSticker(index, "intensity", e.target.value)}><option>low</option><option>medium</option><option>high</option></select></label>
              </div>
              <label>Optional sticker text<input value={s.text} onChange={e => updateSticker(index, "text", e.target.value)} placeholder="Usually blank" /></label>
            </article>)}
          </section>

          <div className="detail-actions">
            <button className="button" type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save in Bunch"}</button>
            <button className="button button-secondary" type="button" onClick={copyCsv}>Copy CSV</button>
            <button className="button button-secondary" type="button" onClick={copyPrompt}>Copy ChatGPT handoff</button>
          </div>
          </> : <p>Loading sticker directions…</p>}
        </div>
      ) : null}
    </ListDetail>
  </main>;
}
