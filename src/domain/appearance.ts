import { z } from "zod";

export const appearancePresetIds = ["midnight", "daylight", "berry", "ocean", "forest", "sunset"] as const;
export type AppearancePresetId = typeof appearancePresetIds[number];

export const paletteSchema = z.object({
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  surface: z.string().regex(/^#[0-9a-f]{6}$/i),
  text: z.string().regex(/^#[0-9a-f]{6}$/i),
  mutedText: z.string().regex(/^#[0-9a-f]{6}$/i),
  primary: z.string().regex(/^#[0-9a-f]{6}$/i),
  secondary: z.string().regex(/^#[0-9a-f]{6}$/i),
}).strict();

export type AppearancePalette = z.infer<typeof paletteSchema>;

export const appearanceInputSchema = z.object({
  mode: z.enum(["preset", "custom"]),
  preset: z.enum(appearancePresetIds),
  palette: paletteSchema,
  glow: z.boolean(),
  reducedDecoration: z.boolean(),
}).strict();

export type AppearanceInput = z.infer<typeof appearanceInputSchema>;
export type AppearanceDocument = AppearanceInput & { updatedAt: string | null };

export const appearancePresets: Record<AppearancePresetId, { label: string; palette: AppearancePalette }> = {
  midnight: { label: "Midnight", palette: { background: "#0a0a14", surface: "#17172d", text: "#f5f3fa", mutedText: "#cecadc", primary: "#55d8ff", secondary: "#ff5cad" } },
  daylight: { label: "Daylight", palette: { background: "#fffafd", surface: "#ffffff", text: "#201323", mutedText: "#514258", primary: "#075985", secondary: "#9d1852" } },
  berry: { label: "Berry", palette: { background: "#1b0b1f", surface: "#321238", text: "#fff5ff", mutedText: "#e3c5e6", primary: "#ff91d0", secondary: "#9ee7ff" } },
  ocean: { label: "Ocean", palette: { background: "#061922", surface: "#0c2b38", text: "#f0fbff", mutedText: "#b8dce8", primary: "#68ddff", secondary: "#ffb86b" } },
  forest: { label: "Forest", palette: { background: "#081a13", surface: "#153426", text: "#f3fff8", mutedText: "#bddcca", primary: "#7ee2aa", secondary: "#ffd166" } },
  sunset: { label: "Sunset", palette: { background: "#211016", surface: "#3a1b24", text: "#fff8f2", mutedText: "#edcabe", primary: "#ffb36b", secondary: "#ff78b7" } },
};

export const defaultAppearance: AppearanceDocument = {
  mode: "preset", preset: "midnight", palette: appearancePresets.midnight.palette,
  glow: true, reducedDecoration: false, updatedAt: null,
};

function channel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const value = hex.slice(1);
    const channels = [0, 2, 4].map(offset => channel(Number.parseInt(value.slice(offset, offset + 2), 16)));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

export type ContrastCheck = { label: string; ratio: number; minimum: number };

export function appearanceContrastChecks(palette: AppearancePalette): ContrastCheck[] {
  return [
    { label: "Primary text on the page", ratio: contrastRatio(palette.text, palette.background), minimum: 4.5 },
    { label: "Primary text on surfaces", ratio: contrastRatio(palette.text, palette.surface), minimum: 4.5 },
    { label: "Muted text on surfaces", ratio: contrastRatio(palette.mutedText, palette.surface), minimum: 4.5 },
    { label: "Primary accent on the page", ratio: contrastRatio(palette.primary, palette.background), minimum: 3 },
    { label: "Secondary accent on the page", ratio: contrastRatio(palette.secondary, palette.background), minimum: 3 },
  ];
}

export function resolvePalette(input: AppearanceInput) {
  return input.mode === "custom" ? input.palette : appearancePresets[input.preset].palette;
}

export function validateAppearance(input: AppearanceInput) {
  return appearanceContrastChecks(resolvePalette(input)).filter(check => check.ratio < check.minimum);
}
