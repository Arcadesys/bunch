import { test, expect } from "./fixtures";

test("timeline shows intervals, filters dates and loads older records without writes", async ({ page, harness }, testInfo) => {
  const current = { ...harness.currentFront!, kind: "FRONTING", origin: "EXPLICIT", startedAt: "2026-09-05T12:00:00.000Z" };
  const previous = { ...current, id: "60000000-0000-4000-8000-000000000002", alterName: "Test Finch", startedAt: "2026-09-03T12:00:00.000Z", endedAt: current.startedAt };
  const requests: URL[] = [];
  await page.route("**/api/v1/fronting/history?*", route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: url.searchParams.has("beforeId")
      ? { data: [previous], meta: { recordedOnly: true } }
      : { data: [current], meta: { recordedOnly: true, nextCursor: { startedAt: current.startedAt, id: current.id, kind: "FRONTING" } } } });
  });
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Who was out when" })).toBeVisible();
  await expect(page.getByText("Fronting · no end recorded")).toBeVisible();
  await page.getByRole("button", { name: "Load older records" }).click();
  await expect(page.getByRole("heading", { name: "Test Finch" })).toBeVisible();
  expect(requests.at(-1)!.searchParams.get("beforeId")).toBe(current.id);
  await page.getByLabel("From date").fill("2026-09-03");
  await page.getByLabel("Through date").fill("2026-09-05");
  await page.getByRole("button", { name: "Show timeline" }).click();
  await expect(page.getByRole("heading", { name: "Test Finch" })).toHaveCount(0);
  await expect.poll(() => requests.at(-1)!.searchParams.has("from")).toBe(true);
  expect(requests.at(-1)!.searchParams.has("beforeId")).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(harness.writes).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("timeline.png"), fullPage: true });
});

test("history distinguishes failed reads from empty records and retries", async ({ page }) => {
  let failed = true;
  await page.route("**/api/v1/fronting/history?*", route => route.fulfill(failed ? { status: 401, json: {} } : { json: { data: [], meta: { recordedOnly: true } } }));
  await page.goto("/history");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Sign in");
  await expect(page.getByText("No recorded fronting sessions match these dates.")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("No recorded fronting sessions match these dates.")).toBeVisible();
});

test("timeline labels overlapping hosting, fronting and unclassified legacy records", async ({page, harness}, testInfo) => {
  const common = { ...harness.currentFront!, startedAt: "2026-09-05T12:00:00.000Z" };
  await page.route("**/api/v1/fronting/history?*", route => route.fulfill({ json: { data: [
    { ...common, kind: "FRONTING", origin: "EXPLICIT", alterName: "Alongside fixture", endedAt: "2026-09-05T14:00:00.000Z" },
    { ...common, id: "60000000-0000-4000-8000-000000000003", kind: "HOSTING", origin: "SYSTEM_HOST_SNAPSHOT", alterName: "Hosting fixture", startedAt: "2026-09-03T12:00:00.000Z" },
    { ...common, id: "60000000-0000-4000-8000-000000000004", kind: "LEGACY_FRONT", origin: "LEGACY_RECORD", alterName: "Legacy fixture", startedAt: "2026-09-01T12:00:00.000Z" },
  ], meta: { recordedOnly: true } } }));
  await page.goto("/history");
  await expect(page.getByText("Hosting · no end recorded", {exact:true})).toBeVisible();
  await expect(page.getByText("Legacy front record · kind not classified")).toBeVisible();
  await expect(page.getByText("Responsible for everything otherwise unclaimed during this period.")).toBeVisible();
  await expect(page.getByRole("heading", {name:"Alongside fixture"})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(harness.writes).toEqual([]);
  await page.screenshot({path: testInfo.outputPath("overlapping-periods.png"), fullPage: true});
});
