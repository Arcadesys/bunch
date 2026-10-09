import { z } from "zod";

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
