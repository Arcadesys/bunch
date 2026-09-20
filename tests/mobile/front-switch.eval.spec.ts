import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

const dock = (page: Page) => page.getByRole("region", { name: "Switch dock" });
const trigger = (page: Page) => dock(page).getByRole("button", { name: /^Switch\./ });

async function openDock(page: Page) {
  await expect(trigger(page)).not.toHaveAccessibleName("Switch. Reading hosting and fronting.");
  await trigger(page).click();
  await expect(page.getByRole("heading", { name: "Record a switch as" })).toBeFocused();
}

test("@eval explicit fronting start preserves the existing episode and current tool", async ({ page, harness }) => {
  await page.goto("/board");
  await openDock(page);
  await page.getByRole("button", { name: "Also here", exact: true }).click();
  await page.getByRole("button", { name: /^Record as also here: Test Finch\./ }).click();
  await expect(trigger(page)).toHaveAccessibleName("Switch. No hosting period is recorded. Fronting alongside: Test Robin, Test Finch.");
  await expect(page.getByRole("heading", { name: "Todos", exact: true })).toBeVisible();
  expect(harness.presence.fronting).toHaveLength(2);
  expect(harness.writes[0].body).toEqual({ alterId: harness.profiles[1].id });
});

test("@eval cancelling a switch writes nothing and restores focus", async ({ page, harness }) => {
  await page.goto("/home");
  await openDock(page);
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toBeFocused();
  expect(harness.writes).toHaveLength(0);
});

test("@eval hosting remains independent when a fronting episode ends", async ({ page, harness }) => {
  harness.presence.hosting = { id: "60000000-0000-4000-8000-000000000009", alterId: harness.profiles[1].id, alterName: "Test Finch", startedAt: "2026-09-04T12:00:00.000Z", version: 1, kind: "HOSTING", origin: "EXPLICIT" };
  await page.goto("/home");
  await openDock(page);
  await page.getByRole("button", { name: "Also here", exact: true }).click();
  await page.getByRole("button", { name: /^End fronting episode for Test Robin\./ }).click();
  await expect(trigger(page)).toHaveAccessibleName("Switch. Hosting: Test Finch. No open fronting episodes are recorded.");
  expect(harness.presence.hosting?.alterName).toBe("Test Finch");
});

test("@eval an ambiguous switch retry reuses the request id", async ({ page, harness }) => {
  harness.loseSwitchResponse = true;
  await page.goto("/home");
  await openDock(page);
  await page.getByRole("button", { name: /^Record as host: Test Finch\./ }).click();
  await expect(dock(page).getByRole("status")).toContainText("may be saved");
  await dock(page).getByRole("button", { name: "Retry switch", exact: true }).click();
  expect(harness.switchCount).toBe(1);
  expect(harness.writes[1].requestId).toBe(harness.writes[0].requestId);
});
