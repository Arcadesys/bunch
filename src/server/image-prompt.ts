import type { AlterView } from "@/domain/contracts";
import { buildAlterImagePrompt, imagePromptInputSchema } from "@/domain/image-prompt";
import { issueImageReadCapability } from "./mcp-authorization";

type ProfileReader = {
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
