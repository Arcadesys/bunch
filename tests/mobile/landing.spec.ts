import { test, expect } from "@playwright/test";

test("public landing loads real artwork without requesting private records", async ({ page }) => {
  const errors: string[] = [];
  const privateRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) privateRequests.push(request.url()); });
  await page.goto("/");
  await expect(page).toHaveTitle("Bunch — your private companion");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A little more");
  const hero = page.getByRole("img", { name: /Eight members of the Arcades/ });
  await expect(hero).toBeVisible();
  await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.getByRole("link", { name: "Get to know Bunch" }).click();
  await expect(page).toHaveURL(/#how-it-helps$/);
  await expect(page.getByRole("heading", { name: /Somewhere to leave the thread/ })).toBeInViewport();
  const portrait = page.getByRole("img", { name: /Tally Arcade/ });
  await portrait.scrollIntoViewIfNeeded();
  await expect.poll(() => portrait.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  const signIn = page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Sign in" });
  await expect(signIn).toHaveAttribute("href", "/auth/login?returnTo=%2Fhome");
  const bounds = await signIn.boundingBox();
  expect(bounds!.height).toBeGreaterThanOrEqual(48);
  expect(bounds!.width).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(privateRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("landing remains readable with doubled text and keyboard navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = "40px"; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe("40px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { name: /A little more/ })).toBeVisible();
});
