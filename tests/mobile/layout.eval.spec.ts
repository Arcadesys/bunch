import { test, expect } from "./fixtures";

test("@eval compact phone header keeps navigation and recipient in the first screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Catch-up for Test Robin" })).toBeVisible();

  const appearance = page.getByRole("link", { name: "Options", exact: true });
  const nav = page.getByRole("navigation", { name: "DIDdy navigation" });
  const heading = page.getByRole("heading", { name: "Catch-up for Test Robin", exact: true });
  await expect(appearance).toBeVisible();
  await expect(nav.getByRole("link", { name: "Catch-up", exact: true })).toBeVisible();
  await expect(heading).toBeVisible();

  const firstScreen = await Promise.all([appearance, heading, ...(await nav.getByRole("link").all())].map((locator) => locator.boundingBox()));
  expect(firstScreen).toEqual(expect.arrayContaining([expect.objectContaining({ y: expect.any(Number) })]));
  for (const rect of firstScreen) {
    expect(rect).not.toBeNull();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(740);
  }

});

test("@eval compact header controls reflow without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Options", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toBeVisible();
  const headerOverflow = await page.locator(".command-topbar").evaluate((header) => ({ client: header.clientWidth, scroll: header.scrollWidth }));
  expect(headerOverflow.scroll, JSON.stringify(headerOverflow)).toBeLessThanOrEqual(headerOverflow.client + 1);
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("system");
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toHaveValue("system");
});
