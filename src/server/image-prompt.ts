import type { AlterView } from "@/domain/contracts";
import { buildAlterImagePrompt, furrySceneInputSchema, imagePromptInputSchema } from "@/domain/image-prompt";
import { issueImageReadCapability } from "./mcp-authorization";

export type ProfileReader = {
  getAlter(ownerId: string, id: string): Promise<AlterView>;
  listAlters(ownerId: string, input: { limit: number; cursor?: string; includeArchived: boolean }): Promise<{ data: AlterView[]; nextCursor?: string }>;
};

export async function prepareAlterImagePrompt(service: ProfileReader, ownerId: string, raw: unknown, publicOrigin: string) {
  const input = imagePromptInputSchema.parse(raw);
  const alters: AlterView[] = [];
  if (input.alters === "all") {
    let cursor: string | undefined;
    do {
      const page = await service.listAlters(ownerId, { limit: 100, cursor, includeArchived: false });
      alters.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
  } else {
    for (const id of new Set(input.alters)) alters.push(await service.getAlter(ownerId, id));
  }
  const referenceMedia = alters.flatMap((alter) => (alter.appearanceReferenceImageIds ?? []).map((imageId) => {
    const image = alter.images.find((item) => item.id === imageId);
    if (!image) throw new Error("One or more selected appearance references are unavailable.");
    return {
      role: "character_reference", alterId: alter.id, alterName: alter.name, imageId,
      contentType: image.contentType,
      src: `${publicOrigin}/api/system/images/inline/${image.id}?cap=${encodeURIComponent(issueImageReadCapability(ownerId, image.id))}`,
    };
  }));
  const result = buildAlterImagePrompt(input.scene, alters);
  return { structuredContent: result, content: [{ type: "text" as const, text: [result.prompt, ...result.notices].join("\n\n") }], _meta: { referenceMedia } };
}

function normalizeName(value: string) {
  return value.trim().toLocaleLowerCase();
}

async function listEveryActiveAlter(service: ProfileReader, ownerId: string) {
  const alters: AlterView[] = [];
  let cursor: string | undefined;
  do {
    const page = await service.listAlters(ownerId, { limit: 100, cursor, includeArchived: false });
    alters.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return alters;
}

/**
 * Prepares one private multi-character Furry scene. References remain solely
 * in metadata and each current selected reference must be present in order.
 */
export async function prepareFurryScene(service: ProfileReader, ownerId: string, raw: unknown, publicOrigin: string) {
  const input = furrySceneInputSchema.parse(raw);
  const activeAlters = await listEveryActiveAlter(service, ownerId);
  const seenIds = new Set<string>();
  const alters = input.alterNames.flatMap((name) => {
    const normalized = normalizeName(name);
    const matches = activeAlters.filter((alter) => normalizeName(alter.name) === normalized || alter.aliases.some((alias) => normalizeName(alias) === normalized));
    if (!matches.length) throw new Error(`SCENE_PARTICIPANT_UNKNOWN: ${name}`);
    if (matches.length > 1) throw new Error(`SCENE_PARTICIPANT_AMBIGUOUS: ${name}`);
    const alter = matches[0];
    return seenIds.has(alter.id) ? [] : (seenIds.add(alter.id), [alter]);
  });
  const missingInitialReference = alters.find((alter) => !alter.appearanceReferenceImageIds.length);
  if (missingInitialReference) throw new Error(`MISSING_APPEARANCE_REFERENCE: ${missingInitialReference.name}`);
  if (alters.reduce((count, alter) => count + alter.appearanceReferenceImageIds.length, 0) > 12) throw new Error("SCENE_REFERENCE_LIMIT_EXCEEDED: A Furry scene supports at most 12 selected references.");

  const prepared = await prepareAlterImagePrompt(service, ownerId, { scene: input.scene, alters: alters.map((alter) => alter.id) }, publicOrigin);
  const { identities } = prepared.structuredContent;
  const { referenceMedia } = prepared._meta;
  if (referenceMedia.length > 12) throw new Error("SCENE_REFERENCE_LIMIT_EXCEEDED: A Furry scene supports at most 12 selected references.");
  let referenceOffset = 0;
  for (const [index, identity] of identities.entries()) {
    if (identity.alterId !== alters[index]?.id || !identity.referenceImageIds.length) throw new Error(`MISSING_APPEARANCE_REFERENCE: ${identity.alterName}`);
    const selected = referenceMedia.slice(referenceOffset, referenceOffset + identity.referenceImageIds.length);
    const correctlyAssociated = selected.length === identity.referenceImageIds.length && selected.every((media, referenceIndex) =>
      media.role === "character_reference" && media.alterId === identity.alterId && media.alterName === identity.alterName && media.imageId === identity.referenceImageIds[referenceIndex],
    );
    if (!correctlyAssociated) throw new Error(`SCENE_REFERENCE_ASSOCIATION_INVALID: ${identity.alterName}`);
    referenceOffset += selected.length;
  }
  if (identities.length !== alters.length || referenceOffset !== referenceMedia.length || !prepared.structuredContent.ready) throw new Error("SCENE_IDENTITY_INCOMPLETE: The current profile selection changed during preparation.");
  return {
    ...prepared,
    content: [{ type: "text" as const, text: "Prepared the Furry scene. This confirms preparation only; no image has been generated or saved." }],
  };
}
