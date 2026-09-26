"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNavigation } from "@/app/app-navigation";
import { PeopleToolsNav } from "@/app/people-tools-nav";
import {
  defaultStickerSlots,
  type StickerPackView,
  type StickerSlot,
} from "@/domain/sticker-pack";

type Person = {
  id: string;
  name: string;
  communicationGuidance?: string;
  appearanceReferenceImageIds?: string[];
};

const demoHeaders = { "x-system-demo": "local" };

function errorMessage(payload: unknown, fallback: string) {
  const error =
    typeof payload === "object" && payload && "error" in payload
      ? (payload as { error?: { message?: unknown } }).error
      : undefined;
  return typeof error?.message === "string" ? error.message : fallback;
}

function cloneSlots(slots: StickerSlot[]) {
  return slots.map((slot) => ({ ...slot }));
}

export default function StickerPacksPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [pack, setPack] = useState<StickerPackView | null>(null);
  const [slots, setSlots] = useState<StickerSlot[]>(() => defaultStickerSlots());
  const [communicationProfile, setCommunicationProfile] = useState("");
  const [notice, setNotice] = useState("Choose a person to design ten everyday reaction stickers.");
  const [busy, setBusy] = useState(false);
  const [telegramUrl, setTelegramUrl] = useState("");
  const requestIds = useRef(new Map<string, string>());

  const selected = useMemo(
    () => people.find((person) => person.id === selectedId) ?? null,
    [people, selectedId],
  );

  const loadPeople = useCallback(async () => {
    const response = await fetch("/api/v1/alters?limit=100", { headers: demoHeaders });
    const payload = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, "Could not load people."));
    const all = Array.isArray(payload.data) ? [...payload.data] : [];
    for (let cursor = payload.meta?.nextCursor; cursor; ) {
      const page = await fetch(
        `/api/v1/alters?limit=100&cursor=${encodeURIComponent(cursor)}`,
        { headers: demoHeaders },
      ).then((item) => item.json());
      all.push(...(Array.isArray(page.data) ? page.data : []));
      cursor = page.meta?.nextCursor;
    }
    setPeople(all);
    const requested = new URLSearchParams(window.location.search).get("person");
    if (requested && all.some((person) => person.id === requested)) setSelectedId(requested);
  }, []);

  useEffect(() => {
    void loadPeople().catch((error) =>
      setNotice(error instanceof Error ? error.message : "Could not load people."),
    );
  }, [loadPeople]);

  useEffect(() => {
    if (!selectedId) {
      setPack(null);
      setSlots(defaultStickerSlots());
      setCommunicationProfile("");
      setTelegramUrl("");
      return;
    }
    let cancelled = false;
    setNotice("Loading this person's sticker board…");
    void fetch(`/api/v1/alters/${encodeURIComponent(selectedId)}/sticker-pack`, {
      headers: demoHeaders,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessage(payload, "Could not load this sticker board."));
        if (cancelled) return;
        const saved = payload.data as StickerPackView | null;
        setPack(saved);
        setSlots(cloneSlots(saved?.slots ?? payload.meta?.defaults ?? defaultStickerSlots()));
        setCommunicationProfile(saved?.communicationProfile ?? "");
        setTelegramUrl(saved?.telegramUrl ?? "");
        setNotice(
          saved
            ? saved.status === "APPROVED"
              ? "Prompt board approved. It is ready for the ChatGPT blocking pass."
              : saved.status === "PUBLISHED"
                ? "This pack has been published to Telegram."
                : "Draft loaded. Keep directing the performances until they feel right."
            : "New board ready. Describe how this person communicates, then direct each reaction.",
        );
      })
      .catch((error) => {
        if (!cancelled)
          setNotice(error instanceof Error ? error.message : "Could not load this sticker board.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  function updateSlot(index: number, patch: Partial<StickerSlot>) {
    setSlots((current) =>
      current.map((slot, itemIndex) => (itemIndex === index ? { ...slot, ...patch } : slot)),
    );
    if (pack?.status === "APPROVED") setNotice("You changed an approved board. Save it as a draft or approve it again.");
  }

  async function save(status: "DRAFT" | "APPROVED" | "PUBLISHED") {
    if (!selected) return;
    if (status === "APPROVED" && slots.some((slot) => !slot.performance.trim())) {
      setNotice("Give every reaction a performance before approving the board.");
      return;
    }
    if (status === "PUBLISHED" && !telegramUrl.trim()) {
      setNotice("Paste the Telegram add-pack link before marking this pack published.");
      return;
    }
    setBusy(true);
    const body = {
      expectedVersion: pack?.version ?? null,
      communicationProfile: communicationProfile.trim() || null,
      status,
      slots,
      telegramUrl: status === "PUBLISHED" ? telegramUrl.trim() : null,
    };
    const fingerprint = JSON.stringify([selected.id, body]);
    const requestId = requestIds.current.get(fingerprint) ?? crypto.randomUUID();
    requestIds.current.set(fingerprint, requestId);
    try {
      const response = await fetch(
        `/api/v1/alters/${encodeURIComponent(selected.id)}/sticker-pack`,
        {
          method: "PUT",
          headers: {
            ...demoHeaders,
            "Content-Type": "application/json",
            "Idempotency-Key": requestId,
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessage(payload, "Could not save this sticker board."));
      setPack(payload.data);
      requestIds.current.delete(fingerprint);
      setNotice(
        status === "APPROVED"
          ? "Prompt board approved. In ChatGPT, ask Bunch to make the sticker pack for this person."
          : status === "PUBLISHED"
            ? "Published pack link saved in Bunch."
            : "Draft saved.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this sticker board.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLaunchPrompt() {
    if (!selected) return;
    const prompt = `Make a ten-reaction sticker pack for ${selected.name} using the approved sticker board in Bunch. Use Bunch's saved appearance references for the final character pass. Start with cheap pose blocking and only repair the sticker I select.`;
    try {
      await navigator.clipboard.writeText(prompt);
      setNotice("Launch prompt copied. Paste it into a ChatGPT chat with Bunch installed.");
    } catch {
      setNotice(prompt);
    }
  }

  function useGuidance() {
    if (!selected?.communicationGuidance) {
      setNotice("No communication guidance is saved on this profile yet.");
      return;
    }
    setCommunicationProfile(selected.communicationGuidance);
    setNotice("Copied the profile's communication guidance into this sticker board. Edit it as needed.");
  }

  return (
    <main className="shell" style={{ maxWidth: "1180px" }}>
      <AppNavigation current="PROFILES" />
      <PeopleToolsNav current="stickers" />
      <header className="site-header">
        <div>
          <p className="eyebrow">Bunch · expressive communication</p>
          <h1>Sticker studio</h1>
          <p>
            Direct ten tiny performances for one person. Bunch stores the creative contract;
            ChatGPT can do the blocking, repairs, final character pass, and Telegram delivery.
          </p>
        </div>
      </header>

      <p className="notice" role="status">{notice}</p>

      <section className="panel" aria-labelledby="person-heading">
        <h2 id="person-heading">1. Choose a person</h2>
        <label>
          Person
          <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
            <option value="">Choose a person</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </label>
        {selected && (
          <p>
            {selected.appearanceReferenceImageIds?.length
              ? `${selected.appearanceReferenceImageIds.length} selected appearance reference(s) are ready for the final character pass.`
              : "No appearance reference is selected yet. You can still design and block the poses first."}
          </p>
        )}
      </section>

      {selected && (
        <>
          <section className="panel" aria-labelledby="personality-heading">
            <h2 id="personality-heading">2. How does {selected.name} communicate?</h2>
            <p>
              This is direction, not biography. Capture the things that change how “thanks,”
              “sorry,” or “hell yes” look for this person.
            </p>
            {selected.communicationGuidance && (
              <button className="button button-secondary" type="button" onClick={useGuidance}>
                Start from saved communication guidance
              </button>
            )}
            <label>
              Communication profile
              <textarea
                rows={5}
                maxLength={5000}
                value={communicationProfile}
                onChange={(event) => setCommunicationProfile(event.target.value)}
                placeholder="Deadpan, expressive hands, affection is understated, signs THANK-YOU, hates baby-talk…"
              />
            </label>
          </section>

          <section className="panel" aria-labelledby="board-heading">
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <h2 id="board-heading">3. Direct the ten reactions</h2>
                <p>These are semantic slots. Change the acting, not the person's identity.</p>
              </div>
              {pack && <strong>Status: {pack.status}</strong>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              {slots.map((slot, index) => (
                <article className="panel" key={slot.stickerId} style={{ margin: 0 }}>
                  <h3 style={{ marginTop: 0 }}>
                    <span aria-hidden="true">{slot.emoji}</span> {slot.intent}
                  </h3>
                  <label>
                    Performance
                    <textarea
                      rows={3}
                      value={slot.performance}
                      onChange={(event) => updateSlot(index, { performance: event.target.value })}
                      placeholder="What do they actually do?"
                    />
                  </label>
                  <label>
                    Expression
                    <input
                      value={slot.expression}
                      onChange={(event) => updateSlot(index, { expression: event.target.value })}
                      placeholder="soft smile, flat stare…"
                    />
                  </label>
                  <label>
                    Gesture
                    <input
                      value={slot.gesture}
                      onChange={(event) => updateSlot(index, { gesture: event.target.value })}
                      placeholder="ASL THANK-YOU, dogeza, tiny wave…"
                    />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label>
                      Framing
                      <select
                        value={slot.framing}
                        onChange={(event) => updateSlot(index, { framing: event.target.value })}
                      >
                        <option value="face close-up">Face close-up</option>
                        <option value="chest-up">Chest-up</option>
                        <option value="waist-up">Waist-up</option>
                        <option value="full body">Full body</option>
                      </select>
                    </label>
                    <label>
                      Intensity
                      <select
                        value={slot.intensity}
                        onChange={(event) =>
                          updateSlot(index, {
                            intensity: event.target.value as StickerSlot["intensity"],
                          })
                        }
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Optional sticker text
                    <input
                      value={slot.text}
                      maxLength={160}
                      onChange={(event) => updateSlot(index, { text: event.target.value })}
                      placeholder="Usually leave blank"
                    />
                  </label>
                  <label>
                    Visual notes
                    <textarea
                      rows={2}
                      value={slot.visualNotes}
                      onChange={(event) => updateSlot(index, { visualNotes: event.target.value })}
                      placeholder="Keep hands readable; tail carries the emotion…"
                    />
                  </label>
                </article>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
              <button className="button button-secondary" type="button" disabled={busy} onClick={() => void save("DRAFT")}>
                Save draft
              </button>
              <button className="button" type="button" disabled={busy} onClick={() => void save("APPROVED")}>
                Approve prompt board
              </button>
              <button className="button button-secondary" type="button" disabled={busy || pack?.status !== "APPROVED"} onClick={() => void copyLaunchPrompt()}>
                Copy ChatGPT launch prompt
              </button>
            </div>
          </section>

          <section className="panel" aria-labelledby="published-heading">
            <h2 id="published-heading">4. When Telegram is done</h2>
            <p>
              After ChatGPT publishes the final pack, save its add-pack link here so Bunch can
              keep the finished artifact with the person it belongs to.
            </p>
            <label>
              Telegram add-pack URL
              <input
                type="url"
                value={telegramUrl}
                onChange={(event) => setTelegramUrl(event.target.value)}
                placeholder="https://t.me/addstickers/..."
              />
            </label>
            <button className="button" type="button" disabled={busy || !telegramUrl.trim()} onClick={() => void save("PUBLISHED")}>
              Mark pack published
            </button>
            {pack?.telegramUrl && (
              <p>
                <a href={pack.telegramUrl} target="_blank" rel="noreferrer">Open this sticker pack in Telegram</a>
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
