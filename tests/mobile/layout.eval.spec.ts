import { test, expect, openSections } from "./fixtures";

// Options is a split view: on phones the Appearance row must be chosen to open it.
async function openAppearance(page: import("@playwright/test").Page) {
  const row = page.locator(".ld-row").filter({ hasText: "Appearance" });
  await expect(row).toBeAttached();
  if (!(await page.locator(".ld-detail").isVisible())) await row.click();
}

test("@eval compact phone header keeps navigation and recipient in the first screen", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "What would help right now?" })).toBeVisible();

  const heading = page.getByRole("heading", { name: "What would help right now?", exact: true });
  // Phones reach the sections through "Open sections" in the top bar; wide screens show the sidebar.
  const menu = page.getByRole("button", { name: "Open sections" });
  const entry = await menu.isVisible() ? menu : page.getByRole("navigation", { name: "Bunch navigation" }).getByRole("link", { name: "Home", exact: true });
  for (const rect of await Promise.all([heading, entry].map((locator) => locator.boundingBox()))) {
    expect(rect).not.toBeNull();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(740);
  }

  const nav = await openSections(page);
  const appearance = nav.getByRole("link", { name: "Options", exact: true });
  await expect(appearance).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  const viewportHeight = page.viewportSize()!.height;
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  expect(navBox!.y).toBeGreaterThanOrEqual(0);
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(viewportHeight + 1);
  // Sixteen sections at 44px each cannot share one 740px screen; every link must still be reachable in place.
  for (const link of await nav.getByRole("link").all()) {
    await link.scrollIntoViewIfNeeded();
    const rect = await link.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewportHeight + 1);
  }
});

test("@eval compact header controls reflow without horizontal overflow", async ({ page }) => {
  await page.goto("/home");
  await (await openSections(page)).getByRole("link", { name: "Options", exact: true }).click();
  await openAppearance(page);
  await expect(page.getByRole("region", { name: "Appearance" })).toBeVisible();
  const headerOverflow = await page.locator(".app-topbar, .app-sidebar").evaluateAll((headers) => headers.map((header) => ({ client: header.clientWidth, scroll: header.scrollWidth })));
  expect(headerOverflow.length, JSON.stringify(headerOverflow)).toBeGreaterThan(0);
  for (const header of headerOverflow) expect(header.scroll, JSON.stringify(headerOverflow)).toBeLessThanOrEqual(header.client + 1);
  await page.getByRole("button", { name: "Midnight", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "midnight");
});
