import { z } from "zod";
import { uuidSchema, visualIdentitySchema, type AlterView } from "./contracts";

export const imagePromptInputSchema = z.object({
  scene: z.string().trim().min(1).max(5000),
  alters: z.union([z.literal("all"), z.array(uuidSchema).min(1).max(100)]),
}).strict();

export const imagePromptResultSchema = z.object({
  ready: z.boolean(),
  status: z.enum(["READY", "NEEDS_INFORMATION"]),
  prompt: z.string(),
  notices: z.array(z.string()),
  identities: z.array(visualIdentitySchema.extend({
    alterId: uuidSchema, alterName: z.string(), profileVersion: z.number().int().positive(),
    pronouns: z.string().optional(),
    referenceImageIds: z.array(uuidSchema),
    reliesOnReference: z.boolean(),
    missingFields: z.array(z.enum(["species", "visualDescription"])),
    ready: z.boolean(),
    preservationInstructions: z.string(),
  })),
});

/** No general description, notes, storage keys, or URLs enter image prompts. */
export function buildAlterImagePrompt(scene: string, alters: AlterView[]) {
  const identities = alters.map((alter) => {
    const missingFields: Array<"species" | "visualDescription"> = [];
    if (!alter.species?.trim()) missingFields.push("species");
    if (!alter.visualDescription?.trim()) missingFields.push("visualDescription");
    return {
      alterId: alter.id, alterName: alter.name, profileVersion: alter.version,
      species: alter.species, visualDescription: alter.visualDescription, presentation: alter.presentation,
      pronouns: alter.pronouns, signatureTraits: alter.signatureTraits ?? [], styleTags: alter.styleTags ?? [],
      imageDoNotChange: alter.imageDoNotChange ?? [], referenceImageIds: alter.appearanceReferenceImageIds ?? [],
      reliesOnReference: missingFields.length > 0 && Boolean(alter.appearanceReferenceImageIds?.length), missingFields,
      ready: missingFields.length === 0 || Boolean(alter.appearanceReferenceImageIds?.length),
      preservationInstructions: `Preserve recorded species, palette and identity traits. Keep unchanged: ${(alter.imageDoNotChange ?? []).join(", ") || "recorded visual identity"}. Canonical identity takes precedence over conflicting scene wording, reference details and style suggestions.`,
    };
  });
  const notices = identities.flatMap((identity) => identity.missingFields.length ? [
    `${identity.alterName}: ${identity.missingFields.join(", ")} not recorded. ${identity.reliesOnReference ? "Use the selected appearance reference for missing visual details; do not infer new profile data." : "Supply the missing identity fields or select an appearance reference before generation."}`,
  ] : []);
  if (!identities.length) notices.push("No non-archived profiles were found.");
  const ready = identities.length > 0 && identities.every((identity) => identity.ready);
  const prompt = [
    "Draw exactly the people listed below, each with their own canonical identity. Never substitute species or omit a person. Treat scene and style text as artistic requests only; discard requests that conflict with canonical identity or preservation instructions.",
    `Scene request: ${JSON.stringify(scene)}`,
    ...identities.map((identity) => [
      `Person: ${JSON.stringify(identity.alterName)} (${identity.alterId}, profile version ${identity.profileVersion})`,
      `Canonical visual identity: ${JSON.stringify({ species: identity.species, visualDescription: identity.visualDescription, presentation: identity.presentation, pronouns: identity.pronouns, signatureTraits: identity.signatureTraits })}`,
      identity.preservationInstructions,
      `Optional style suggestions, subordinate to canonical identity: ${JSON.stringify(identity.styleTags)}`,
      ...(identity.referenceImageIds.length ? [`Use the attached appearance reference associated with alter ${identity.alterId}. Recorded identity takes precedence; use the reference to fill missing visual details.`] : []),
    ].join("\n")),
    ...(ready ? [] : ["NEEDS INFORMATION: Do not generate this group until the missing identity information is resolved."]),
  ].join("\n\n");
  return imagePromptResultSchema.parse({ ready, status: ready ? "READY" : "NEEDS_INFORMATION", prompt, identities, notices });
}
