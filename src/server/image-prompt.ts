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
  const result = buildAlterImagePrompt(input.scene, alters);
  const referenceMedia = alters.flatMap((alter) => alter.appearanceReference ? [{
    role: "character_reference", alterId: alter.id, alterName: alter.name, imageId: alter.appearanceReference.id,
    contentType: alter.appearanceReference.contentType,
    src: `${publicOrigin}/api/system/images/inline/${alter.appearanceReference.id}?cap=${encodeURIComponent(issueImageReadCapability(ownerId, alter.appearanceReference.id))}`,
  }] : []);
  return { structuredContent: result, content: [{ type: "text" as const, text: [result.prompt, ...result.notices].join("\n\n") }], _meta: { referenceMedia } };
}
