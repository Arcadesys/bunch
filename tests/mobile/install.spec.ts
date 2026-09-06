import { test, expect } from "./fixtures";

test("phone installation guide is discoverable, readable, and links back to catch-up", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/options");
  await page.getByRole("link", { name: /Install on your phone/ }).click();
  await expect(page).toHaveURL(/\/install$/);
  await expect(page).toHaveTitle(/Bunch/);
  await expect(page.getByRole("heading", { name: "Add Bunch to your home screen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "iPhone · Safari" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Android · Chrome" })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "40px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const link of await page.locator("main a").all()) {
    const rect = await link.boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("link", { name: "Open Catch-up", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Catch-up for Test Robin" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("browser install prompt survives navigation and cancellation offers manual instructions", async ({ page }) => {
  await page.goto("/options");
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) });
    window.dispatchEvent(event);
  });
  await page.getByRole("link", { name: /Install on your phone/ }).click();
  await page.getByRole("button", { name: "Install Bunch", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Installation cancelled");
  await expect(page.getByRole("button", { name: "Install Bunch", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Android · Chrome" })).toBeVisible();
});

test("standalone launch is identified and install assets are valid", async ({ page, request }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  await page.goto("/install");
  await expect(page.getByRole("status")).toContainText("already using Bunch");
  const manifestLink = await page.locator('link[rel="manifest"]').getAttribute("href");
  const response = await request.get(manifestLink!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({ short_name: "Bunch", start_url: "/", scope: "/", display: "standalone" });
  for (const icon of manifest.icons) {
    const asset = await request.get(icon.src);
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["content-type"]).toContain("image/png");
    const size = Number(icon.sizes.split("x")[0]);
    const bytes = await asset.body();
    expect(bytes.readUInt32BE(16)).toBe(size);
    expect(bytes.readUInt32BE(20)).toBe(size);
  }
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Bunch");
  const appleIcon = await request.get((await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"))!);
  expect(appleIcon.ok()).toBe(true);
});
