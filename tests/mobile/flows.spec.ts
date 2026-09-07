import { test, expect } from "./fixtures";

test("catch-up loads, acknowledges, and reloads server-owned review state", async ({ page, harness }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto("/");
  await expect(page).toHaveTitle("Bunch — your private companion");
  await expect(page.getByRole("heading", { name: "Catch-up for Test Robin" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("initial-viewport.png"), fullPage: false });
  await page.getByText(/More saved changes/).click();
  const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Fixture note", exact: true }) });
  await row.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(row.locator(".command-state")).toHaveText("Reviewed");
  await expect(page.locator(".command-notice")).toContainText("underlying note is unchanged");
  expect(harness.writes[0].body).toEqual({ expectedVersion: 1, state: "ACKNOWLEDGED" });
  expect(harness.writes[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(harness.session?.items[1].statusLabel).toBe("BLOCKED");
  await page.reload();
  await page.getByText(/More saved changes/).click();
  await expect(row.locator(".command-state")).toHaveText("Reviewed");
  await expect(page.getByLabel("1 of 4 reviewed")).toBeVisible();
  expect(errors).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("catch-up.png"), fullPage: false });
});

test("defer is opt-in and next switch is an explicit return choice", async ({ page, harness }) => {
  await page.goto("/");
  await page.getByText(/More saved changes/).click();
  const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Fixture note", exact: true }) });
  await row.getByRole("button", { name: "Review later", exact: true }).click();
  expect(harness.writes).toHaveLength(0);
  await row.getByLabel("Return time").selectOption("NEXT_SWITCH");
  await row.getByRole("button", { name: "Confirm defer" }).click();
  await expect(row.locator(".command-state")).toContainText("Returns at next recorded period");
  expect(harness.writes[0].body).toEqual({ expectedVersion: 1, state: "DEFERRED", deferUntilNextSwitch: true });
});

test("missing custom defer time sends no write", async ({ page, harness }) => {
  await page.goto("/");
  await page.getByText(/More saved changes/).click();
  const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Fixture note", exact: true }) });
  await row.getByRole("button", { name: "Review later", exact: true }).click();
  await row.getByLabel("Return time").selectOption("CUSTOM");
  await row.getByRole("button", { name: "Confirm defer" }).click();
  await expect(page.locator(".command-notice")).toHaveText("Choose a custom return time.");
  expect(harness.writes).toHaveLength(0);
});

test("stale write is announced without false success or optimistic state", async ({ page, harness }) => {
  harness.writeStatus = 409;
  await page.goto("/");
  await page.getByText(/More saved changes/).click();
  const row = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Fixture note", exact: true }) });
  await row.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(page.locator(".command-notice")).toContainText("Record changed");
  await expect(row.locator(".command-state")).toHaveText("Not reviewed");
  await expect(row.getByRole("button", { name: "Mark reviewed", exact: true })).toBeEnabled();
});

test("navigation opens saved records and identifies the active page", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Bunch navigation" });
  for (const [label, path, type] of [["Todos", "/board", "todo"], ["Notes", "/notes", "note"], ["Threads", "/threads", "thread"]]) {
    await nav.getByRole("link", { name: "Options", exact: true }).click();
    await page.getByRole("link").filter({ has: page.getByRole("heading", { name: label, exact: true }) }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(nav.getByRole("link", { name: "Options", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText(`Fixture ${type}`);
  }
});

test("thread suggestion requires a separate confirmation and excludes transcript", async ({ page, harness }) => {
  await page.goto("/threads");
  await page.getByLabel("Thread link").fill("https://example.invalid/approved-thread");
  await page.getByLabel("Title", { exact: true }).fill("Synthetic thread");
  await page.getByLabel("Approved summary").fill("Approved summary only.");
  await page.getByLabel("Key decision or action").fill("Review the bounded change.");
  await page.getByRole("button", { name: "Save suggestion" }).click();
  await expect(page.locator(".command-notice")).toContainText("Thread suggestion saved");
  expect(harness.writes).toHaveLength(1);
  expect(Object.keys(harness.writes[0].body).sort()).toEqual(["approvedSummary", "externalThreadId", "keyDecisionOrAction", "recipientAlterIds", "source", "title", "url"]);
  await page.getByRole("button", { name: "Confirm important thread" }).click();
  await expect(page.locator(".command-notice")).toContainText("Important thread confirmed");
  expect(harness.writes).toHaveLength(2);
  expect(harness.writes[1].path).toMatch(/\/confirm$/);
});

test("first-time and empty catch-up states render without writes", async ({ page, harness }) => {
  harness.session!.firstTime = true;
  await page.goto("/");
  await page.locator(".catch-up-window > summary").click();
  await expect(page.getByText(/First catch-up for this experience/)).toBeVisible();
  harness.session = null;
  await page.reload();
  await expect(page.locator(".command-notice")).toHaveText("No catch-up is open.");
  expect(harness.writes).toHaveLength(0);
});
