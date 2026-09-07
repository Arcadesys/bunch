import { test, expect } from "./fixtures";

const gallery = {
  alters: [
    { id: "robin", name: "Test Robin", images: [{ id: "robin-profile", contentType: "image/png", role: "profile", order: 0 }, { id: "robin-1", contentType: "image/png", role: "image", order: 1 }] },
    { id: "finch", name: "Test Finch", images: [{ id: "finch-1", contentType: "image/png", role: "image", order: 1 }] },
  ],
  generalImages: [{ id: "general-1", contentType: "image/png", role: "image", order: 1 }],
};

test("shared gallery gives visitors an intro, accessible person navigation, and larger pictures", async ({ page }) => {
  await page.route("**/api/public/gallery/share-token", async (route) => route.fulfill({ json: gallery }));
  await page.route("**/api/public/gallery/share-token/images/**", async (route) => route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2dQAAAABJRU5ErkJggg==", "base64") }));
  await page.goto("/gallery/share/share-token");
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
  await page.goto("/gallery/share/not-valid");
  await expect(page.getByRole("status")).toHaveText("This shared gallery is unavailable.");
  await expect(page.getByText("specific internal reason")).toHaveCount(0);
});

test("account share controls create links and revoke with an idempotency key", async ({ page }) => {
  const calls: Array<{ method: string; key: string | undefined; body?: unknown }> = [];
  let shares = [{ id: "existing", expiresAt: "2026-09-07T12:00:00.000Z", revokedAt: null, createdAt: "2026-09-06T12:00:00.000Z" }];
  await page.route("**/api/v1/account", async (route) => route.fulfill({ json: { data: { state: "ACTIVE", canShareGallery: true, role: "FRIEND", displayName: "Test system", emailVerified: true, usedBytes: 0, quotaBytes: 100 } } }));
  await page.route("**/api/v1/account/gallery-shares**", async (route) => {
    const request = route.request();
    calls.push({ method: request.method(), key: request.headers()["idempotency-key"], body: request.postDataJSON() });
    if (request.method() === "GET") return route.fulfill({ json: { data: shares } });
    if (request.method() === "POST") return route.fulfill({ status: 201, json: { data: { id: "new", expiresAt: null, revokedAt: null, createdAt: "2026-09-06T12:00:00.000Z", token: "new", url: "http://127.0.0.1:3217/gallery/share/new" } } });
    shares = [];
    return route.fulfill({ json: { data: { revoked: true } } });
  });
  await page.goto("/");
  const shareSystem = page.getByRole("link", { name: "Share system", exact: true });
  await expect(shareSystem).toBeVisible();
  await shareSystem.press("Enter");
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Share a read-only photo gallery" })).toBeVisible();
  await page.getByLabel("Link lifetime").selectOption("1w");
  await page.getByRole("button", { name: "Create gallery link" }).click();
  await expect(page.getByLabel("Gallery link", { exact: true })).toHaveValue("http://127.0.0.1:3217/gallery/share/new");
  await page.getByRole("button", { name: "Revoke link" }).first().click();
  expect(calls.find((call) => call.method === "POST")).toMatchObject({ body: { duration: "1w" } });
  expect(calls.find((call) => call.method === "POST")?.key).toBeFalsy();
  expect(calls.find((call) => call.method === "DELETE")?.key).toBeTruthy();
});

test("existing owner can create and keyboard-copy a link without accepting an invitation", async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const url = "http://127.0.0.1:3217/gallery/share/disposable-fixture-token";
  const writes: string[] = [];
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { state: "LEGACY", canShareGallery: true, emailVerified: true } } }));
  await page.route("**/api/v1/account/gallery-shares", async route => {
    if (route.request().method() === "POST") { writes.push("create"); return route.fulfill({ status: 201, json: { data: { id: "fixture", url, expiresAt: null } } }); }
    return route.fulfill({ json: { data: writes.length ? [{ id: "fixture", expiresAt: null }] : [] } });
  });
  await page.goto("/account");
  await expect(page.getByText("Account status: Existing system account")).toBeVisible();
  await expect(page.getByLabel("Invitation code")).toHaveCount(0);
  await expect(page.getByText(/whole system’s profile names and all gallery photos/)).toBeVisible();
  await page.getByRole("button", { name: "Create gallery link", exact: true }).press("Enter");
  const copy = page.getByRole("button", { name: "Copy link", exact: true });
  await copy.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Gallery link copied.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  expect(await copy.evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth,document.documentElement.clientWidth]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]+1);
  expect(await copy.evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(140);
  await copy.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("gallery-copy.png"), fullPage: false });
  await page.reload();
  await expect(page.getByText(/cannot be recovered after reloading/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create gallery link", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Revoke link", exact: true })).toBeEnabled();
  expect(writes).toEqual(["create"]);
  expect(errors).toEqual([]);
  await expect(page).toHaveURL("http://127.0.0.1:3217/account");
  await expect(page).toHaveTitle(/Bunch/);
});

test("clipboard failure selects the new link for manual copying", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("Denied"); } } }));
  await page.route("**/api/v1/account", r => r.fulfill({ json: { data: { state: "ACTIVE", canShareGallery: true, role: "OPERATOR" } } }));
  await page.route("**/api/v1/account/gallery-shares", r => r.fulfill({ json: { data: r.request().method() === "POST" ? { id: "new", url: "http://127.0.0.1:3217/gallery/share/manual-fixture", expiresAt: null } : [] } }));
  await page.goto("/account");
  await page.getByRole("button", { name: "Create gallery link", exact: true }).click();
  await page.getByRole("button", { name: "Copy link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Could not copy automatically");
  const input = page.getByLabel("Gallery link", { exact: true });
  await expect(input).toBeFocused();
  expect(await input.evaluate(e => (e as HTMLInputElement).selectionEnd)).toBe((await input.inputValue()).length);
});

test("unenrolled and blocked accounts never get sharing controls", async ({ page }) => {
  for (const state of ["NOT_ENROLLED", "REVOKED", "DELETED", "ACTIVE"]) {
    await page.route("**/api/v1/account", r => r.fulfill({ json: { data: { state, canShareGallery: false, emailVerified: true } } }));
    await page.goto("/account");
    await expect(page.getByText(`Account status: ${state.replaceAll("_", " ")}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create gallery link", exact: true })).toHaveCount(0);
  }
  await page.route("**/api/v1/account", r => r.fulfill({ status: 401, json: {} }));
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create gallery link", exact: true })).toHaveCount(0);
});
