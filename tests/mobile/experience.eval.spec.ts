import { test, expect } from "./fixtures";

// Acceptance evals intentionally stay red when a user-facing requirement fails.
// Do not mark known defects as expected failures: a repair should turn them green.
test("@eval appearance is accessible and persists after reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Options", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Appearance", exact: true }).selectOption("light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("link", { name: "Options", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Appearance", exact: true })).toHaveValue("light");
});

test("@eval reflow fits the viewport including enlarged text and long content", async ({ page, harness }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Catch-up for Test Robin/ })).toBeVisible();
  const baseline = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  await testInfo.attach("baseline-reflow", { body: JSON.stringify(baseline), contentType: "application/json" });
  expect.soft(baseline.scroll, `Normal text: ${JSON.stringify(baseline)}`).toBeLessThanOrEqual(baseline.client + 1);
  harness.session!.items[0].title = "LongUnbrokenRecordTitle".repeat(8);
  await page.reload();
  await page.getByText(/More saved changes/).click();
  await expect(page.getByRole("heading", { name: /LongUnbrokenRecordTitle/ })).toBeVisible();
  await page.addStyleTag({ content: "html { font-size: 40px !important; }" });
  const overflow = await page.evaluate(() => ({ width: window.innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.client + 1);
});

test("@eval all navigation and action targets are at least 44 by 44 CSS pixels", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Catch-up for Test Robin/ })).toBeVisible();
  const undersized = await page.getByRole("main").locator("a, button, select, input:not([type=hidden]), textarea").evaluateAll((elements) => elements.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return [];
    return rect.width < 44 || rect.height < 44 ? [{ name: element.textContent?.trim(), width: rect.width, height: rect.height }] : [];
  }));
  expect(undersized).toEqual([]);
});

test("@eval signed-out state never claims a confirmed front or empty private inbox", async ({ page, harness }) => {
  harness.readStatus = 401;
  await page.goto("/");
  await expect(page.locator(".command-notice")).toContainText("Sign in");
  await expect(page.getByText("Current front · confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nothing in this view needs your eyes.", { exact: true })).toHaveCount(0);
});

for (const kind of ["note", "todo"]) {
  test(`@eval successful ${kind} save announces success and clears the form`, async ({ page, harness }) => {
    await page.goto(kind === "note" ? "/notes" : "/board");
    const input = page.getByLabel(kind === "note" ? "Note" : "Title", { exact: true });
    await input.fill("Synthetic save check");
    await page.getByRole("button", { name: kind === "note" ? "Save note" : "Save todo", exact: true }).click();
    await expect(page.locator(".command-notice")).toContainText(kind === "note" ? "Note saved to Notes." : "Todo saved to Todos.");
    await expect(input).toHaveValue("");
    expect(harness.writes).toHaveLength(1);
  });
}

test("@eval switch-front action opens a selectable confirmation flow", async ({ page, harness }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Update hosting or fronting", exact: true }).click();
  expect(harness.writes).toHaveLength(0);
  await expect(page.getByRole("combobox", { name: /front|alter|profile/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /confirm change/i })).toBeVisible();
});
