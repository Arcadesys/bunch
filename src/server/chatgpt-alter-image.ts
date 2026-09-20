import { chatgptAlterImageInputSchema, chatgptAlterImageResultSchema } from "@/domain/chatgpt-alter-image";
import { prepareFurryScene, type ProfileReader } from "@/server/image-prompt";

/**
 * Prepares Bunch's private selected references for a ChatGPT image handoff.
 *
 * The model-facing packet contains only readiness and counts. Authorized
 * reference capabilities and the user-provided scene-file metadata remain in
 * MCP _meta for the host widget to consume.
 */
export async function prepareChatgptAlterImage(service: ProfileReader, ownerId: string, raw: unknown, publicOrigin: string) {
  const input = chatgptAlterImageInputSchema.parse(raw);
  const prepared = await prepareFurryScene(service, ownerId, {
    scene: input.scene,
    alterNames: input.alterNames,
  }, publicOrigin);
  const identities = prepared.structuredContent.identities.map((identity) => ({
    alterName: identity.alterName,
    referenceCount: identity.referenceImageIds.length,
  }));
  const result = chatgptAlterImageResultSchema.parse({
    ready: true,
    status: "READY",
    scene: input.scene,
    identities,
    referenceCount: identities.reduce((total, identity) => total + identity.referenceCount, 0),
  });
  return {
    structuredContent: result,
    content: [{ type: "text" as const, text: `Prepared ${result.referenceCount} private appearance reference${result.referenceCount === 1 ? "" : "s"} for the requested ChatGPT image generation. No image has been generated or saved.` }],
    _meta: {
      sceneImage: {
        file_id: input.sceneImage.file_id,
        ...(input.sceneImage.mime_type ? { mime_type: input.sceneImage.mime_type } : {}),
        ...(input.sceneImage.file_name ? { file_name: input.sceneImage.file_name } : {}),
      },
      referenceMedia: prepared._meta.referenceMedia,
    },
  };
}
