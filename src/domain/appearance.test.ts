import assert from "node:assert/strict";
import test from "node:test";
import { appearanceContrastChecks, appearancePresets, defaultAppearance, validateAppearance } from "./appearance";

test("every curated appearance preset passes the shared contrast gate", () => {
  for (const preset of Object.values(appearancePresets)) {
    assert.deepEqual(validateAppearance({ ...defaultAppearance, preset: Object.entries(appearancePresets).find(([, value]) => value === preset)![0] as keyof typeof appearancePresets, palette: preset.palette }), []);
  }
});

test("custom palettes report the failing color pair and measured ratio", () => {
  const palette = { ...appearancePresets.midnight.palette, text: "#111111", mutedText: "#121212" };
  const failures = appearanceContrastChecks(palette).filter(check => check.ratio < check.minimum);
  assert.ok(failures.some(check => check.label === "Primary text on the page"));
  assert.ok(failures.every(check => Number.isFinite(check.ratio)));
});
