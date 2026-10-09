import { expect, test } from "@playwright/test";

test("missing Auth0 configuration keeps private pages closed while public pages render", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-system-e2e-subject": "invalid subject" },
  });
  const page = await context.newPage();
  const baseURL = String(testInfo.project.use.baseURL);

  const privateResponse = await page.goto(new URL("/home", baseURL).href);
  expect(privateResponse?.status()).toBe(503);
  await expect(page.getByText("Bunch sign-in is temporarily unavailable. Private pages are locked.")).toBeVisible();

  const landingResponse = await page.goto(new URL("/", baseURL).href);
  expect(landingResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A little more");

  const demoResponse = await page.goto(new URL("/demo", baseURL).href);
  expect(demoResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "What would help right now?" })).toBeVisible();
  await context.close();
});
