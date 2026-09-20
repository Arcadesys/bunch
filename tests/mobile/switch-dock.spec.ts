import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// The dock names the recorded state, so the assertions read the accessible
// name rather than the abbreviated visible lines.
const dock = (page: Page) => page.getByRole("region", { name: "Switch dock" });
const switchButton = (page: Page) => dock(page).getByRole("button", { name: /^Switch\./ });
const panelHeading = (page: Page) => page.getByRole("heading", { name: "Record a switch as" });
const loggedHeading = (page: Page) => page.locator("#switch-dock-logged-heading");

// Handlers are attached by effects, so a test that acts straight after goto can
// beat hydration. A settled presence read proves the client is live.
async function liveDock(page: Page) {
  const trigger = switchButton(page);
  await expect(trigger).not.toHaveAccessibleName("Switch. Reading hosting and fronting.");
  return trigger;
}

async function openDock(page: Page) {
  await (await liveDock(page)).click();
  await expect(page.getByRole("dialog", { name: "Record a switch as" })).toBeVisible();
  await expect(panelHeading(page)).toBeFocused();
  await expect(page.getByRole("button", { name: /^Record as host: Test Finch\./ })).toBeEnabled();
}

test("the dock names the host and every open fronter", async ({ page, harness }) => {
  harness.presence.hosting = { id: "60000000-0000-4000-8000-000000000009", alterId: harness.profiles[1].id, alterName: "Test Finch", startedAt: "2026-09-04T12:00:00.000Z", version: 1, kind: "HOSTING", origin: "EXPLICIT" };
  await page.goto("/board");
  await expect(switchButton(page)).toHaveAccessibleName("Switch. Hosting: Test Finch. Fronting alongside: Test Robin.");
  await expect(dock(page)).toContainText("Host Test Finch");
  await expect(dock(page)).toContainText("Also Test Robin");
});

test("one tap on a face records the host without leaving the page", async ({ page, harness }) => {
  await page.goto("/board");
  await openDock(page);
  expect(harness.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Record as host: Test Finch. Not recorded.", exact: true }).click();

  await expect(loggedHeading(page)).toContainText("Test Finch is hosting · logged");
  await expect(loggedHeading(page)).toBeFocused();
  await expect(panelHeading(page)).toHaveCount(0);
  expect(harness.writes).toHaveLength(1);
  expect(harness.writes[0].path).toBe("/api/v1/hosting/current");
  expect(harness.writes[0].body).toEqual({ alterId: harness.profiles[1].id, expectedVersion: null });
  await expect(switchButton(page)).toHaveAccessibleName("Switch. Hosting: Test Finch. Fronting alongside: Test Robin.");
  // Still on Todos: switching never navigated away.
  await expect(page.getByRole("heading", { name: "Todos", exact: true })).toBeVisible();
});

test("tapping someone already fronting ends only their episode", async ({ page, harness }) => {
  await page.goto("/board");
  await openDock(page);
  await page.getByRole("button", { name: "Also here", exact: true }).click();
  await page.getByRole("button", { name: /^End fronting episode for Test Robin\./ }).click();

  await expect(loggedHeading(page)).toContainText("Test Robin’s episode ended");
  expect(harness.writes).toHaveLength(1);
  expect(harness.writes[0].path).toBe("/api/v1/presence/fronting/end");
  expect(harness.writes[0].body).toEqual({ episodeId: "60000000-0000-4000-8000-000000000001", expectedVersion: 1 });
  // An end has nothing to describe, so no energy or trigger is asked.
  await expect(page.getByRole("group", { name: "Energy" })).toHaveCount(0);
  await expect(switchButton(page)).toHaveAccessibleName("Switch. No hosting period is recorded. No open fronting episodes are recorded.");
});

test("Undo retracts the tapped switch instead of recording its opposite", async ({ page, harness }) => {
  await page.goto("/board");
  await openDock(page);
  await page.getByRole("button", { name: "Also here", exact: true }).click();
  await page.getByRole("button", { name: /^Record as also here: Test Finch\./ }).click();
  await expect(switchButton(page)).toHaveAccessibleName("Switch. No hosting period is recorded. Fronting alongside: Test Robin, Test Finch.");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(switchButton(page)).toHaveAccessibleName("Switch. No hosting period is recorded. Fronting alongside: Test Robin.");
  await expect(dock(page).getByRole("status")).toContainText("Undone.");
  await expect(switchButton(page)).toBeFocused();
  expect(harness.writes.map(write => write.path)).toEqual(["/api/v1/presence/fronting/start", "/api/v1/presence/retract"]);
  expect(harness.writes[1].body).toEqual({ changeRequestId: harness.writes[0].requestId });
});

test("energy and trigger are saved with the arrival only when Done is pressed", async ({ page, harness }) => {
  await page.goto("/board");
  await openDock(page);
  await page.getByRole("button", { name: /^Record as host: Test Finch\./ }).click();
  await page.getByRole("button", { name: "Energy 4 of 5", exact: true }).click();
  await page.getByRole("group", { name: "Trigger" }).getByRole("button", { name: "Stress", exact: true }).click();
  expect(harness.writes).toHaveLength(1);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dock(page).getByRole("status")).toContainText("Energy and trigger saved with Test Finch’s record.");
  expect(harness.writes).toHaveLength(2);
  expect(harness.writes[1].path).toBe(`/api/v1/presence/periods/${harness.presence.hosting!.id}/details`);
  expect(harness.writes[1].body).toEqual({ energy: 4, trigger: "Stress", expectedVersion: 1 });
  await expect(switchButton(page)).toBeFocused();
});

test("Escape closes the panel without writing, and S opens it from any page", async ({ page, harness }) => {
  await page.goto("/notes");
  await liveDock(page);
  await page.keyboard.press("s");
  await expect(panelHeading(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panelHeading(page)).toHaveCount(0);
  await expect(switchButton(page)).toBeFocused();
  expect(harness.writes).toHaveLength(0);
});

test("the switch modal stays reachable in a short viewport and contains keyboard focus", async ({ page, harness }) => {
  const consoleErrors: string[] = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 360 });
  await page.goto("/board");
  await openDock(page);
  const modal = page.getByRole("dialog", { name: "Record a switch as" });
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => document.activeElement?.closest("dialog")?.id)).toBe("switch-dock-panel");
  await panelHeading(page).focus();
  const bounds = await modal.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(360);

  const lastProfile = page.getByRole("button", { name: /^Record as host: Test Finch\./ });
  await lastProfile.scrollIntoViewIfNeeded();
  await expect(lastProfile).toBeInViewport();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("dialog")?.id)).toBe("switch-dock-panel");
  }
  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(switchButton(page)).toBeFocused();
  expect(consoleErrors).toEqual([]);
  expect(harness.writes).toHaveLength(0);
});

test("a lost response retries the same switch once", async ({ page, harness }) => {
  harness.loseSwitchResponse = true;
  await page.goto("/board");
  await openDock(page);
  await page.getByRole("button", { name: /^Record as host: Test Finch\./ }).click();
  await expect(dock(page).getByRole("status")).toContainText("may be saved");
  await expect(page.getByRole("button", { name: /^Record as host: Test Robin\./ })).toBeDisabled();

  await dock(page).getByRole("button", { name: "Retry switch", exact: true }).click();
  await expect(loggedHeading(page)).toContainText("Test Finch is hosting");
  expect(harness.switchCount).toBe(1);
  expect(harness.writes[1].requestId).toBe(harness.writes[0].requestId);
});

test("a signed-out dock still offers Switch and never raises an alert", async ({ page, harness }) => {
  harness.switchReadStatus = 401;
  await page.goto("/board");
  await expect(switchButton(page)).toHaveAccessibleName("Switch. Sign in to read hosting and fronting.");
  await expect(dock(page).getByRole("alert")).toHaveCount(0);
  await switchButton(page).click();
  await expect(panelHeading(page)).toBeFocused();
  await expect(dock(page)).toContainText("Sign in to record switches.");
  await expect(page.getByRole("button", { name: /^Record as/ })).toHaveCount(0);
});
