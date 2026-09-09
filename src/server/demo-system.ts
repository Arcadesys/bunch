import { z } from "zod";

// Public fiction only. Kept separate from repositories, local walkthrough
// fixtures, account IDs, and production records. Never seed a real tenant.
const personId = z.enum(["fenton", "benny", "dot"]);
const recordId = z.string();
export const demoSystemSchema = z.object({
  label: z.literal("Demo system"),
  fictional: z.literal(true),
  readOnly: z.literal(true),
  asOf: z.string().datetime(),
  notice: z.string(),
  people: z.array(z.object({ id: personId, name: z.string(), description: z.string(), strengths: z.array(z.string()), dislikes: z.array(z.string()) })),
  relationships: z.array(z.object({ people: z.array(personId), description: z.string() })),
  presence: z.object({ hostingPersonId: personId, frontingPersonIds: z.array(personId) }),
  history: z.array(z.object({ id: recordId, personId, kind: z.enum(["HOSTING", "FRONTING"]), startedAt: z.string().datetime(), endedAt: z.string().datetime().nullable() })),
  tasks: z.array(z.object({ id: recordId, title: z.string(), details: z.string(), relevantTo: z.array(personId), handledBy: personId, status: z.enum(["OPEN", "DONE"]), dueOn: z.null() })),
  notes: z.array(z.object({ id: recordId, author: personId, relevantTo: z.array(personId), body: z.string(), createdAt: z.string().datetime() })),
  decisions: z.array(z.object({ id: recordId, relevantTo: z.array(personId), body: z.string(), createdAt: z.string().datetime() })),
  catchUp: z.object({ personId, episodeId: recordId, windowStart: z.string().datetime(), windowEnd: z.string().datetime(), overview: z.string(), items: z.array(z.object({ recordId, reviewState: z.enum(["NEW", "ACKNOWLEDGED"]) })), coverage: z.string() }),
});

const sample: z.infer<typeof demoSystemSchema> = {
  label: "Demo system", fictional: true, readOnly: true, asOf: "2026-09-09T14:00:00Z",
  notice: "Fictional sample people and history, served by Bunch. Dates are a fixed story snapshot, not current presence. Nothing here belongs to a real user's system. Demo IDs cannot be used to edit private records.",
  people: [
    { id: "fenton", name: "Fenton", description: "Fenton and Benny tease each other, but really love each other. Fenton handles household scheduling because Benny hates scheduling.", strengths: ["Household scheduling"], dislikes: ["Emotional writing"] },
    { id: "benny", name: "Benny", description: "Benny and Fenton tease each other, but really love each other. Benny handles emotional writing because Fenton hates it.", strengths: ["Emotional writing"], dislikes: ["Scheduling"] },
    { id: "dot", name: "Dot", description: "A kid in the Demo system. Dot is no relation to Fenton or Benny.", strengths: [], dislikes: [] },
  ],
  relationships: [
    { people: ["fenton", "benny"], description: "They tease each other and really love each other. They share responsibility while dividing work by their strengths." },
    { people: ["dot", "fenton", "benny"], description: "Dot is no relation to either Fenton or Benny." },
  ],
  presence: { hostingPersonId: "fenton", frontingPersonIds: ["benny", "dot"] },
  history: [
    { id: "hosting-fenton", personId: "fenton", kind: "HOSTING", startedAt: "2026-09-07T09:00:00Z", endedAt: null },
    { id: "fronting-benny-previous", personId: "benny", kind: "FRONTING", startedAt: "2026-09-08T16:00:00Z", endedAt: "2026-09-08T18:00:00Z" },
    { id: "fronting-fenton", personId: "fenton", kind: "FRONTING", startedAt: "2026-09-09T10:00:00Z", endedAt: "2026-09-09T12:30:00Z" },
    { id: "fronting-benny", personId: "benny", kind: "FRONTING", startedAt: "2026-09-09T13:00:00Z", endedAt: null },
    { id: "fronting-dot", personId: "dot", kind: "FRONTING", startedAt: "2026-09-09T13:30:00Z", endedAt: null },
  ],
  tasks: [
    { id: "thank-you-note", title: "Write a thank-you note for the gift we received.", details: "The system received a gift. Fenton reminded Benny to write the thank-you note; Benny handles the writing. The donor, gift, and deadline are unspecified.", relevantTo: ["fenton", "benny"], handledBy: "benny", status: "OPEN", dueOn: null },
    { id: "household-schedule", title: "Review the household schedule together.", details: "Fenton handled the scheduling and left the plan available to Benny. Their shared responsibility does not depend on who is fronting.", relevantTo: ["fenton", "benny"], handledBy: "fenton", status: "DONE", dueOn: null },
  ],
  notes: [
    { id: "schedule-note", author: "fenton", relevantTo: ["fenton", "benny"], body: "Household scheduling is handled. Benny, you are welcome: no calendar wrestling required.", createdAt: "2026-09-08T19:00:00Z" },
    { id: "thank-you-reminder", author: "fenton", relevantTo: ["benny"], body: "Benny, please write a thank-you note for the gift we received. I can handle the schedule; you handle the words with feelings.", createdAt: "2026-09-09T12:00:00Z" },
    { id: "benny-reply", author: "benny", relevantTo: ["fenton"], body: "Fine, calendar champion. I'll handle the thank-you note. Love you, even when you make emotional writing sound like a household appliance.", createdAt: "2026-09-09T13:15:00Z" },
  ],
  decisions: [
    { id: "shared-work", relevantTo: ["fenton", "benny"], body: "Fenton handles household scheduling. Benny handles emotional writing. Both remain connected to shared commitments; hosting and fronting do not assign the work.", createdAt: "2026-09-08T19:15:00Z" },
  ],
  catchUp: {
    personId: "benny", episodeId: "fronting-benny", windowStart: "2026-09-08T18:00:00Z", windowEnd: "2026-09-09T13:00:00Z",
    overview: "Fenton handled the household schedule and left you a reminder to write a thank-you note for the gift the system received. You handle the writing; the thank-you task is still open. Fenton remains host while you are fronting.",
    items: [{ recordId: "schedule-note", reviewState: "ACKNOWLEDGED" }, { recordId: "shared-work", reviewState: "ACKNOWLEDGED" }, { recordId: "thank-you-reminder", reviewState: "NEW" }, { recordId: "thank-you-note", reviewState: "NEW" }],
    coverage: "Fictional saved records only. This is not retrieved conversation history. The window starts at Benny's previous recorded fronting end and does not prove absence. Review status does not complete the underlying task.",
  },
};

export function getDemoSystem() {
  return demoSystemSchema.parse(sample);
}
