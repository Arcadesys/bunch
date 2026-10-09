import { expect, test } from "./fixtures";

test("appearance presets preview and persist to the account", async ({ page }) => {
  await page.goto("/options");
  await page.getByRole("button", { name: "Appearance" }).click();
  const studio = page.getByRole("region", { name: "Appearance" });
  for (const [label, id] of [["Midnight", "midnight"], ["Daylight", "daylight"], ["Berry", "berry"], ["Ocean", "ocean"], ["Forest", "forest"], ["Sunset", "sunset"]]) {
    await studio.getByRole("button", { name: label }).click();
    await expect(page.locator("html")).toHaveAttribute("data-appearance", id);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await studio.getByRole("button", { name: "Ocean" }).click();
  await studio.getByRole("button", { name: "Save theme" }).click();
  await expect(studio.getByRole("status")).toContainText("saved to this Bunch account");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "ocean");
});

test("custom palette cannot save when required contrast fails", async ({ page }) => {
  await page.goto("/options");
  await page.getByRole("button", { name: "Appearance" }).click();
  const studio = page.getByRole("region", { name: "Appearance" });
  await studio.getByText("Customize this palette").click();
  await studio.getByLabel("Primary text hex value").fill("#111111");
  await expect(studio.getByRole("alert")).toContainText("Primary text on the page");
  await expect(studio.getByRole("button", { name: "Save theme" })).toBeDisabled();
  await studio.getByRole("button", { name: "Reset to Bunch defaults" }).click();
  await expect(studio.getByRole("button", { name: "Save theme" })).toBeEnabled();
  await studio.getByText("Customize this palette").click();
  await studio.getByLabel("Primary text hex value").fill("#oops");
  await expect(studio.getByRole("alert")).toContainText("six-digit hexadecimal color");
  await expect(studio.getByRole("button", { name: "Save theme" })).toBeDisabled();
});

test("appearance controls reflow and retain readable targets", async ({ page }) => {
  await page.goto("/options");
  await page.getByRole("button", { name: "Appearance" }).click();
  const studio = page.getByRole("region", { name: "Appearance" });
  const save = studio.getByRole("button", { name: "Save theme" });
  const box = await save.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
