import { test, expect } from "./fixtures";

test("saved records work without conversation history and offer one next step", async ({ page, harness }, info) => {
  const todo = harness.session!.items[1];
  for (let i = 5; i <= 8; i++) harness.session!.items.push({ ...todo, entryId: `30000000-0000-4000-8000-00000000000${i}`, title: `Extra task ${i}` });
  harness.session!.totalCount = harness.session!.items.length;
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("Bunch — your private companion");
  await expect(page.getByText(/Conversation history is not read here/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(page.locator(".command-row:visible")).toHaveCount(3);
  await page.getByText(/More needs attention/).click();
  await expect(page.locator(".command-row:visible")).toHaveCount(6);
  await page.getByRole("button", { name: "I’m overwhelmed", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Next step", exact: true })).toBeFocused();
  await expect(page.locator(".command-row:visible")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open Fixture todo", exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "40px"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/resume-day-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Show full catch-up" }).click();
  await expect(page.getByRole("heading", { name: "What changed", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  expect(harness.writes).toEqual([]);
});

test("empty and failed states do not require an arrival", async ({ page, harness }) => {
  harness.session = null; harness.currentFront = null; harness.presence.fronting = [];
  await page.goto("/");
  await expect(page.getByText(/No catch-up open\./)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Todos", exact: true })).toBeVisible();
  harness.readStatus = 500;
  await page.getByRole("button", { name: "Refresh catch-up" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("Saved records could not be loaded");
  harness.readStatus = 200;
  await page.getByRole("button", { name: "Retry catch-up", exact: true }).click();
  await expect(page.getByText(/No catch-up open\./)).toBeVisible();
  expect(harness.writes).toEqual([]);
});

test("failed refresh preserves dated records and optional uncertainty does not write", async ({ page, harness }) => {
  await page.goto("/");
  await page.locator(".presence-overview > summary").click();
  await expect(page.getByText(/Test Robin was last recorded starting fronting/)).toBeVisible();
  await page.getByText("Still accurate? Optional check", { exact: true }).click();
  await page.getByRole("button", { name: "I’m unsure", exact: true }).click();
  await expect(page.getByText("No changes saved. It’s okay to be unsure.")).toBeVisible();
  harness.readStatus = 500;
  await page.getByRole("button", { name: "Refresh catch-up" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("previously loaded records");
  await expect(page.getByRole("heading", { name: "Fixture todo", exact: true })).toBeVisible();
  expect(harness.writes).toEqual([]);
});

test("lost review save response retries with the same receipt and payload", async ({ page, harness }) => {
  const requests: { key: string | undefined; body: unknown }[] = [];
  await page.route("**/api/v1/catch-up/items/*", async route => {
    requests.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    if (requests.length === 1) return route.abort("failed");
    const saved = structuredClone(harness.session!);
    saved.items[1].reviewState = "DEFERRED";
    saved.items[1].version++;
    return route.fulfill({ json: { data: saved } });
  });
  await page.goto("/");
  const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Fixture todo", exact: true }) });
  await row.getByRole("button", { name: "Review later", exact: true }).click();
  await row.getByRole("button", { name: "Confirm defer" }).click();
  await expect(page.locator(".command-notice")).toContainText("Failed to fetch");
  await row.getByRole("button", { name: "Confirm defer" }).click();
  await expect(page.locator(".command-notice")).toContainText("review postponed");
  expect(requests).toHaveLength(2);
  expect(requests[0].key).toBeTruthy();
  expect(requests[1]).toEqual(requests[0]);
});

test("unavailable conversation review leaves saved records usable", async ({ page }) => {
  await page.route("**/api/v1/catch-up/review?*", route => route.fulfill({ status: 503, json: { error: { message: "Conversation review unavailable." } } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Fixture todo", exact: true })).toBeVisible();
  await page.getByText("More: saved review and coverage", { exact: true }).click();
  await expect(page.getByText("Conversation review unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText(/saved-record briefing above is still available/)).toBeVisible();
});

test("authentication loss clears the previously loaded catch-up", async ({ page, harness }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Fixture todo", exact: true })).toBeVisible();
  harness.readStatus = 401;
  await page.getByRole("button", { name: "Refresh catch-up", exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in with Google", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture todo", exact: true })).toHaveCount(0);
});
