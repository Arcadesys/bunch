import { test, expect } from "./fixtures";

test("@eval compact phone header keeps navigation and recipient in the first screen", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "What would help right now?" })).toBeVisible();

  const appearance = page.getByRole("link", { name: "Options", exact: true });
  const nav = page.getByRole("navigation", { name: "Bunch navigation" });
  const heading = page.getByRole("heading", { name: "What would help right now?", exact: true });
  await expect(appearance).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await expect(heading).toBeVisible();

  const firstScreen = await Promise.all([appearance, heading, ...(await nav.getByRole("link").all())].map((locator) => locator.boundingBox()));
  expect(firstScreen).toEqual(expect.arrayContaining([expect.objectContaining({ y: expect.any(Number) })]));
  for (const rect of firstScreen) {
    expect(rect).not.toBeNull();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(740);
  }

});

test("@eval compact header controls reflow without horizontal overflow", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Options", exact: true }).click();
  await expect(page.getByRole("region", { name: "Appearance" })).toBeVisible();
  const headerOverflow = await page.locator(".command-topbar").evaluate((header) => ({ client: header.clientWidth, scroll: header.scrollWidth }));
  expect(headerOverflow.scroll, JSON.stringify(headerOverflow)).toBeLessThanOrEqual(headerOverflow.client + 1);
  await page.getByRole("button", { name: "Midnight", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "midnight");
});
