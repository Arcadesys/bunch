import { imagePromptResultSchema } from "@/domain/image-prompt";
import { z } from "zod";

type ImagePromptResult = z.infer<typeof imagePromptResultSchema>;

export type PreparedFurrySceneForChatGPT = {
  structuredContent: ImagePromptResult;
  _meta?: {
    referenceMedia?: Array<{
      role: string;
      alterId: string;
      alterName: string;
      imageId: string;
      contentType: string;
      src?: string;
    }>;
  };
};

export type SceneReferenceByteLoader = (reference: {
  alterId: string;
  imageId: string;
}) => Promise<{
  bytes: Uint8Array;
  contentType: string;
}>;

export type ChatGPTSceneReferenceSlot = {
  slot: string;
  order: number;
  alterId: string;
  alterName: string;
  imageId: string;
};

export type ChatGPTSceneHandoff = {
  structuredContent: ImagePromptResult & {
    referenceSlots: ChatGPTSceneReferenceSlot[];
    bunchGeneration: "none";
    allowanceCharged: false;
  };
  content: Array<
    | { type: "text"; text: string }
    | {
        type: "image";
        data: string;
        mimeType: string;
        _meta: ChatGPTSceneReferenceSlot;
      }
  >;
};

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function fail(message: string): never {
  throw new Error(`CHATGPT_SCENE_HANDOFF_INVALID: ${message}`);
}

function normalizedContentType(value: unknown) {
  return typeof value === "string" ? value.split(";", 1)[0].trim().toLowerCase() : "";
}

function hasImageSignature(bytes: Uint8Array, contentType: string) {
  if (contentType === "image/png") {
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  }
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function referenceSlots(prepared: PreparedFurrySceneForChatGPT) {
  const result = imagePromptResultSchema.safeParse(prepared?.structuredContent);
  if (!result.success || !result.data.ready || result.data.status !== "READY") fail("the resolved scene is not ready");

  const media = prepared?._meta?.referenceMedia;
  if (!Array.isArray(media)) fail("appearance references are missing");

  const expected = result.data.identities.flatMap((identity) => identity.referenceImageIds.map((imageId) => ({
    alterId: identity.alterId,
    alterName: identity.alterName,
    imageId,
  })));
  if (media.length !== expected.length) fail("appearance reference count changed");

  return expected.map((reference, index) => {
    const selected = media[index];
    if (!selected || selected.role !== "character_reference" || selected.alterId !== reference.alterId || selected.alterName !== reference.alterName || selected.imageId !== reference.imageId) {
      fail(`appearance reference order or association is invalid at slot ${index + 1}`);
    }
    const declaredType = normalizedContentType(selected.contentType);
    if (!allowedImageTypes.has(declaredType)) fail(`appearance reference ${index + 1} is not an allowed image type`);
    return {
      slot: `reference-${index + 1}`,
      order: index + 1,
      ...reference,
      declaredType,
    };
  });
}

/**
 * Converts a resolved, owner-authorized Furry scene into a ChatGPT image input.
 * This function only reads reference bytes through the injected owner-scoped
 * loader. It does not render, charge, persist, or contact an image provider.
 */
export async function prepareChatGPTSceneHandoff(
  prepared: PreparedFurrySceneForChatGPT,
  loadImage: SceneReferenceByteLoader,
): Promise<ChatGPTSceneHandoff> {
  const slots = referenceSlots(prepared);
  const images = [] as ChatGPTSceneHandoff["content"];

  for (const slot of slots) {
    let loaded: Awaited<ReturnType<SceneReferenceByteLoader>>;
    try {
      loaded = await loadImage({ alterId: slot.alterId, imageId: slot.imageId });
    } catch {
      fail(`appearance reference ${slot.order} could not be loaded`);
    }
    const contentType = normalizedContentType(loaded?.contentType);
    const bytes = loaded?.bytes;
    if (contentType !== slot.declaredType || !allowedImageTypes.has(contentType) || !(bytes instanceof Uint8Array) || !bytes.length || !hasImageSignature(bytes, contentType)) {
      fail(`appearance reference ${slot.order} is missing, mismatched, or not image data`);
    }
    images.push({
      type: "image",
      data: Buffer.from(bytes).toString("base64"),
      mimeType: contentType,
      _meta: {
        slot: slot.slot,
        order: slot.order,
        alterId: slot.alterId,
        alterName: slot.alterName,
        imageId: slot.imageId,
      },
    });
  }

  const publicSlots = slots.map(({ declaredType: _declaredType, ...slot }) => slot);
  const slotManifest = publicSlots.map((slot) => `${slot.slot}: ${slot.alterName} (${slot.alterId})`).join("\n");
  return {
    structuredContent: {
      ...prepared.structuredContent,
      referenceSlots: publicSlots,
      bunchGeneration: "none",
      allowanceCharged: false,
    },
    content: [
      { type: "text", text: `${prepared.structuredContent.prompt}\n\nAttached appearance references, in order:\n${slotManifest}` },
      ...images,
    ],
  };
}
