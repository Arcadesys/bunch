import { z } from "zod";
import { uuidSchema } from "./contracts";

export const stickerIntentSchema = z.enum(["yes","no","applause","thanks","sorry","laugh","love","confused","congrats","bye"]);
export type StickerIntent = z.infer<typeof stickerIntentSchema>;

export const stickerDraftSchema = z.object({
  id: stickerIntentSchema,
  intent: z.string().min(1).max(80),
  emoji: z.string().min(1).max(16),
  performance: z.string().max(500),
  expression: z.string().max(300),
  gesture: z.string().max(300),
  framing: z.string().max(120),
  intensity: z.enum(["low","medium","high"]),
  text: z.string().max(120),
});

export const stickerPackDraftSchema = z.object({
  version: z.literal(1),
  alterId: z.string().uuid(),
  personalitySummary: z.string().max(3000),
  notes: z.string().max(3000),
  stickers: z.array(stickerDraftSchema).length(10),
});

export type StickerPackDraft = z.infer<typeof stickerPackDraftSchema>;

export function defaultStickerPack(alterId: string): StickerPackDraft {
  const rows = [
    ["yes","Yes / approval","👍"],
    ["no","No / rejection","👎"],
    ["applause","Praise / applause","👏"],
    ["thanks","Thank you","🙏"],
    ["sorry","Sorry / oops","😬"],
    ["laugh","Laughter","😂"],
    ["love","Love / affection","❤️"],
    ["confused","Confusion / what?","❓"],
    ["congrats","Congratulations","🎉"],
    ["bye","Bye / goodnight","👋"],
  ] as const;
  return {
    version: 1,
    alterId,
    personalitySummary: "",
    notes: "",
    stickers: rows.map(([id,intent,emoji]) => ({
      id, intent, emoji, performance: "", expression: "", gesture: "", framing: "chest-up",
      intensity: "medium" as const, text: "",
    })),
  };
}

export function stickerPackCsv(pack: StickerPackDraft) {
  const quote = (value: string) => `"${value.replaceAll('"','""')}"`;
  const header = ["sticker_id","intent","emoji","performance","expression","gesture","framing","intensity","text"];
  const rows = pack.stickers.map(s => [s.id,s.intent,s.emoji,s.performance,s.expression,s.gesture,s.framing,s.intensity,s.text]);
  return [header, ...rows].map(row => row.map(value => quote(String(value))).join(",")).join("\n");
}

// Versioned saved-pack contracts remain available to API and MCP clients.

export const stickerPackStatusSchema = z.enum(["DRAFT", "APPROVED", "PUBLISHED"]);
export const stickerIntensitySchema = z.enum(["low", "medium", "high"]);

export const DEFAULT_STICKER_SLOTS = [
  { stickerId: "yes", intent: "Yes / approval", emoji: "👍" },
  { stickerId: "no", intent: "No / rejection", emoji: "👎" },
  { stickerId: "applause", intent: "Praise / applause", emoji: "👏" },
  { stickerId: "thanks", intent: "Thank you", emoji: "🙏" },
  { stickerId: "sorry", intent: "Sorry / oops", emoji: "😬" },
  { stickerId: "laugh", intent: "Laughter", emoji: "😂" },
  { stickerId: "love", intent: "Love / affection", emoji: "❤️" },
  { stickerId: "confused", intent: "Confusion / what?", emoji: "❓" },
  { stickerId: "congrats", intent: "Congratulations", emoji: "🎉" },
  { stickerId: "bye", intent: "Bye / goodnight", emoji: "👋" },
] as const;

export const stickerSlotSchema = z.object({
  stickerId: z.string().trim().min(1).max(60),
  intent: z.string().trim().min(1).max(160),
  emoji: z.string().trim().min(1).max(32),
  performance: z.string().trim().max(1000).default(""),
  expression: z.string().trim().max(500).default(""),
  gesture: z.string().trim().max(500).default(""),
  framing: z.string().trim().max(120).default("chest-up"),
  intensity: stickerIntensitySchema.default("medium"),
  text: z.string().trim().max(160).default(""),
  visualNotes: z.string().trim().max(1000).default(""),
}).strict();
export type StickerSlot = z.infer<typeof stickerSlotSchema>;

function uniqueSlots(slots: StickerSlot[], ctx: z.RefinementCtx) {
  const ids = new Set<string>();
  for (const slot of slots) {
    if (ids.has(slot.stickerId)) {
      ctx.addIssue({ code: "custom", message: `Duplicate sticker ID: ${slot.stickerId}` });
      return;
    }
    ids.add(slot.stickerId);
  }
}

export const stickerSlotsSchema = z.array(stickerSlotSchema).length(10).superRefine(uniqueSlots);

export const stickerPackViewSchema = z.object({
  id: uuidSchema,
  alterId: uuidSchema,
  alterName: z.string(),
  communicationProfile: z.string().nullable(),
  status: stickerPackStatusSchema,
  slots: stickerSlotsSchema,
  telegramUrl: z.string().url().regex(/^https:\/\/t\.me\/addstickers\/[A-Za-z0-9_]+$/).nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type StickerPackView = z.infer<typeof stickerPackViewSchema>;

export const saveStickerPackSchema = z.object({
  requestId: uuidSchema,
  expectedVersion: z.number().int().positive().nullable(),
  communicationProfile: z.string().trim().max(5000).nullable().default(null),
  status: stickerPackStatusSchema.default("DRAFT"),
  slots: stickerSlotsSchema,
  telegramUrl: z.string().url().regex(/^https:\/\/t\.me\/addstickers\/[A-Za-z0-9_]+$/).nullable().default(null),
}).strict();
export type SaveStickerPackInput = z.infer<typeof saveStickerPackSchema>;

export function defaultStickerSlots(): StickerSlot[] {
  return DEFAULT_STICKER_SLOTS.map((slot) => ({
    ...slot,
    performance: "",
    expression: "",
    gesture: "",
    framing: "chest-up",
    intensity: "medium",
    text: "",
    visualNotes: "",
  }));
}
