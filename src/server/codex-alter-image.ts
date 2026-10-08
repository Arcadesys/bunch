import { codexAlterImageInputSchema, codexAlterImageResultSchema } from "@/domain/codex-alter-image";
import { prepareFurryScene, type ProfileReader } from "@/server/image-prompt";

/** Permanent session-authenticated routes carry no image-read capability.
 * The browser must authenticate as the owner; MCP never transfers image bytes.
 */
export async function prepareCodexAlterImage(service: ProfileReader, ownerId: string, raw: unknown, publicOrigin: string) {
  const input = codexAlterImageInputSchema.parse(raw);
  const prepared = await prepareFurryScene(service, ownerId, input, publicOrigin, "browser");
  const result = codexAlterImageResultSchema.parse({
    status: "REFERENCE_DOWNLOAD_REQUIRED",
    scene: input.scene,
    prompt: prepared.structuredContent.prompt,
    references: prepared._meta.referenceMedia.map((reference) => ({
      alterId: reference.alterId,
      alterName: reference.alterName,
      imageId: reference.imageId,
      contentType: reference.contentType,
      galleryUrl: `${new URL(publicOrigin).origin}/gallery?id=${reference.alterId}`,
      downloadUrl: reference.src,
    })),
    providerCalled: false,
    allowanceCharged: false,
    saved: false,
  });
  return {
    structuredContent: result,
    content: [{ type: "text" as const, text: "Prepared the exact selected appearance references for Codex. Open each galleryUrl in an authenticated browser, download only the links matching the ordered downloadUrls, and inspect every local image. Then use Codex's image generator once with all downloaded references and the canonical prompt. If the browser is signed out or any reference is unavailable, report that blocker; do not draw from IDs or text alone, ask for re-uploads, or start a paid Bunch job. No reference has been transferred and no image has been generated or saved." }],
  };
}
