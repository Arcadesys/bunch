import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

// The header names the recorded state, so the assertions read the accessible
// name rather than the abbreviated visible text.
const switchButton = (page: Page) => page.getByRole("button", { name: /^Switch\./ });
const formHeading = (page: Page) => page.getByRole("heading", { name: "Set host or start a side fronter" });

// The click and keyboard handlers are attached by effects, so a test that acts
// straight after goto can beat hydration. A settled presence read proves the
// client is live, because only an effect can replace the loading label.
async function liveHeader(page: Page) {
  const trigger = switchButton(page);
  await expect(trigger).not.toHaveAccessibleName("Switch. Reading hosting and fronting.");
  return trigger;
}

test("header Switch records a side fronter without leaving the current page", async ({ page, harness }) => {
  await page.goto("/board");
  const trigger = switchButton(page);
  await expect(trigger).toHaveAccessibleName("Switch. No hosting period is recorded. Fronting alongside: Test Robin.");

  await trigger.click();
  await expect(formHeading(page)).toBeFocused();
  await page.getByLabel("Side fronter profile", { exact: true }).selectOption(harness.profiles[1].id);
  expect(harness.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Confirm side-fronter arrival", exact: true }).click();

  await expect(formHeading(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAccessibleName("Switch. No hosting period is recorded. Fronting alongside: Test Robin, Test Finch.");
  expect(harness.writes).toHaveLength(1);
  expect(harness.writes[0].path).toBe("/api/v1/presence/fronting/start");
  expect(harness.writes[0].body).toEqual({ alterId: harness.profiles[1].id });
  // The header confirms what was recorded, so the change is never silent.
  await expect(page.locator(".app-navigation").getByRole("status")).toContainText("Fronting episode recorded. Hosting is unchanged.");
  // Still on Todos: switching never navigated away.
  await expect(page.getByRole("heading", { name: "Todos", exact: true })).toBeVisible();
});

test("header Switch closes on Escape without writing and restores focus", async ({ page, harness }) => {
  await page.goto("/board");
  await (await liveHeader(page)).click();
  await expect(formHeading(page)).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(formHeading(page)).toHaveCount(0);
  await expect(switchButton(page)).toBeFocused();
  expect(harness.writes).toHaveLength(0);
});

test("the S shortcut opens the switch form from any page", async ({ page }) => {
  await page.goto("/notes");
  await liveHeader(page);
  await page.keyboard.press("s");
  await expect(formHeading(page)).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(switchButton(page)).toBeFocused();
});

test("the header names the host and every open fronter", async ({ page, harness }) => {
  harness.presence.hosting = { id: "60000000-0000-4000-8000-000000000009", alterId: harness.profiles[1].id, alterName: "Test Finch", startedAt: "2026-09-04T12:00:00.000Z", version: 1, kind: "HOSTING", origin: "EXPLICIT" };
  await page.goto("/board");
  const trigger = switchButton(page);
  await expect(trigger).toHaveAccessibleName("Switch. Hosting: Test Finch. Fronting alongside: Test Robin.");
  await expect(trigger).toContainText("Host Test Finch");
  await expect(trigger).toContainText("Also Test Robin");
});

test("a signed-out header still offers Switch and reports nothing as read", async ({ page, harness }) => {
  harness.switchReadStatus = 401;
  await page.goto("/board");
  await expect(switchButton(page)).toHaveAccessibleName("Switch. Sign in to read hosting and fronting.");
  // A failed read is never reported in the header itself, and never blocks the button.
  await expect(page.locator(".app-navigation").getByRole("alert")).toHaveCount(0);
  await switchButton(page).click();
  await expect(formHeading(page)).toBeFocused();
});
