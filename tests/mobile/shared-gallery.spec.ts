import { test, expect } from "./fixtures";

const gallery = {
  alters: [
    { id: "robin", name: "Test Robin", images: [{ id: "robin-profile", contentType: "image/png", role: "profile-picture", order: 0 }, { id: "robin-1", contentType: "image/png", role: "gallery", order: 1 }] },
    { id: "finch", name: "Test Finch", images: [{ id: "finch-1", contentType: "image/png", role: "gallery", order: 1 }] },
  ],
  generalImages: [{ id: "general-1", contentType: "image/png", role: "gallery", order: 1 }],
};

test("shared gallery gives visitors an intro, accessible person navigation, and larger pictures", async ({ page }) => {
  await page.route("**/api/public/gallery/share-token", async (route) => route.fulfill({ json: gallery }));
  await page.route("**/api/public/gallery/share-token/images/**", async (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2dQAAAABJRU5ErkJggg==", "base64") }));
  await page.goto("/shared-gallery/share-token");
  await expect(page.getByRole("heading", { name: "Who’s here" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to the gallery" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "People in this gallery" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to the gallery" }).click();
  const nav = page.getByRole("navigation", { name: "People in this gallery" });
  await expect(nav.getByRole("button", { name: "Test Robin" })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("button", { name: "Test Finch" }).press("Enter");
  await expect(page.getByRole("heading", { name: "Test Finch", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open larger view: Picture 1 for Test Finch" }).click();
  await expect(page.getByRole("dialog", { name: "Picture 1 for Test Finch" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "General gallery" })).toBeVisible();
  const reflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(reflow.scroll).toBeLessThanOrEqual(reflow.client + 1);
});

test("unavailable shared gallery is generic and does not expose token details", async ({ page }) => {
  await page.route("**/api/public/gallery/not-valid", async (route) => route.fulfill({ status: 404, json: { error: { message: "specific internal reason" } } }));
  await page.goto("/shared-gallery/not-valid");
  await expect(page.getByRole("status")).toHaveText("This shared gallery is unavailable.");
  await expect(page.getByText("specific internal reason")).toHaveCount(0);
});

test("account share controls create links and revoke with an idempotency key", async ({ page }) => {
  const calls: Array<{ method: string; key: string | undefined; body?: unknown }> = [];
  let shares = [{ id: "existing", expiresAt: "2026-09-07T12:00:00.000Z", revokedAt: null, createdAt: "2026-09-06T12:00:00.000Z" }];
  await page.route("**/api/v1/account", async (route) => route.fulfill({ json: { data: { state: "ACTIVE", role: "FRIEND", displayName: "Test system", emailVerified: true, usedBytes: 0, quotaBytes: 100 } } }));
  await page.route("**/api/v1/account/gallery-shares**", async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), key: request.headers()["idempotency-key"], body: request.postDataJSON() });
    if (request.method() === "GET") return route.fulfill({ json: { data: shares } });
    if (request.method() === "POST") return route.fulfill({ status: 201, json: { data: { id: "new", expiresAt: null, revokedAt: null, createdAt: "2026-09-06T12:00:00.000Z", token: "new", url: "http://127.0.0.1:3217/gallery/share/new" } } });
    shares = [];
    return route.fulfill({ json: { data: { revoked: true } } });
  });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Share a read-only photo gallery" })).toBeVisible();
  await page.getByLabel("Link lifetime").selectOption("1w");
  await page.getByRole("button", { name: "Create gallery link" }).click();
  await expect(page.getByRole("link", { name: "http://127.0.0.1:3217/gallery/share/new" })).toBeVisible();
  await page.getByRole("button", { name: "Revoke link" }).first().click();
  expect(calls.find((call) => call.method === "POST")).toMatchObject({ body: { duration: "1w" } });
  expect(calls.find((call) => call.method === "POST")?.key).toBeFalsy();
  expect(calls.find((call) => call.method === "DELETE")?.key).toBeTruthy();
});
