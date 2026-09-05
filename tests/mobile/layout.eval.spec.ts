import { test, expect } from "./fixtures";

test("@eval compact phone header keeps navigation, preferences access, and Needs your eyes in the first screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Catch-up for Test Robin" })).toBeVisible();

  const appearance = page.locator(".app-preferences > summary");
  const nav = page.getByRole("navigation", { name: "DIDdy navigation" });
  const heading = page.getByRole("heading", { name: "Needs your eyes", exact: true });
  await expect(appearance).toBeVisible();
  await expect(nav.getByRole("link", { name: "Catch-up", exact: true })).toBeVisible();
  await expect(heading).toBeVisible();

  const firstScreen = await Promise.all([appearance, heading, ...(await nav.getByRole("link").all())].map((locator) => locator.boundingBox()));
  expect(firstScreen).toEqual(expect.arrayContaining([expect.objectContaining({ y: expect.any(Number) })]));
  for (const rect of firstScreen) {
    expect(rect).not.toBeNull();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(740);
  }
  const firstRecord = await page.getByRole("heading", { name: "Fixture note", exact: true }).boundingBox();
  expect(firstRecord).not.toBeNull();
  expect(firstRecord!.y + firstRecord!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test("@eval compact header controls reflow without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  await page.locator(".app-preferences > summary").click();
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toBeVisible();
  const headerOverflow = await page.locator(".command-topbar").evaluate((header) => ({ client: header.clientWidth, scroll: header.scrollWidth }));
  expect(headerOverflow.scroll, JSON.stringify(headerOverflow)).toBeLessThanOrEqual(headerOverflow.client + 1);
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("system");
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toHaveValue("system");
});
