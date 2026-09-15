/** Fictional fixtures only. This module must never import a repository or database. */
export function fictionalDemoEnabled() {
  return process.env.SYSTEM_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
}

export function getFictionalDemo() {
  return {
    systemName: "Demo system",
    fictional: true,
    readOnly: true,
    people: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Foo", description: "Enjoys planning relaxed afternoons and keeping a short checklist." },
      { id: "11111111-1111-4111-8111-111111111112", name: "Bar", description: "Enjoys baking and leaving helpful notes for the others." },
      { id: "11111111-1111-4111-8111-111111111113", name: "Baz", description: "Enjoys music and putting together playlists to share." },
    ],
    hosting: { name: "Foo", context: "Fictional hosting responsibility" },
    fronting: [{ name: "Bar", context: "Fictional fronting presence" }],
    notes: [
      { from: "Bar", relevantTo: ["Foo"], title: "Picnic snacks", body: "I packed muffins for our pretend picnic. Foo, please bring the blanket." },
      { from: "Baz", relevantTo: ["Foo", "Bar", "Baz"], title: "Afternoon playlist", body: "The sample playlist starts with gentle piano, then a few upbeat songs." },
    ],
    tasks: [{ title: "Pack the picnic bag", relevantTo: ["Foo", "Bar"], status: "Open", detail: "Foo brings the blanket; Bar brings the muffins." }],
  };
}
