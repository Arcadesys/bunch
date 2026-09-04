import { test, expect } from "./fixtures";

test("@eval compact phone header keeps navigation, Appearance, and Needs your eyes in the first screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome back, Test Robin" })).toBeVisible();

  const appearance = page.getByLabel("Appearance");
  const nav = page.getByRole("navigation", { name: "System navigation" });
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
  await expect(page.getByLabel("Appearance")).toBeVisible();
  const headerOverflow = await page.locator(".command-topbar").evaluate((header) => ({ client: header.clientWidth, scroll: header.scrollWidth }));
  expect(headerOverflow.scroll, JSON.stringify(headerOverflow)).toBeLessThanOrEqual(headerOverflow.client + 1);
  await page.getByLabel("Appearance").selectOption("system");
  await expect(page.getByLabel("Appearance")).toHaveValue("system");
});
