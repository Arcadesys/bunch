import { test, expect, fixtureSession } from "./fixtures";

test("@eval front switch requires explicit confirmation, updates view and survives reload", async ({ page, harness }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch front", exact: true }).click();
  const chooser = page.getByLabel("Who is fronting now?");
  await chooser.selectOption(harness.profiles[1].id);
  expect(harness.writes).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("switch-confirmation.png") });
  const before = structuredClone(harness.currentFront);
  await page.getByRole("button", { name: "Confirm front switch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Test Finch" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Test Finch is now the recorded current front.");
  expect(harness.writes[0].body).toEqual({ alterId: harness.profiles[1].id, expectedCurrentVersion: before!.version, expectedCurrentSessionId: before!.id });
  expect(harness.switchCount).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome back, Test Finch" })).toBeVisible();
});

test("@eval cancelling a front switch writes nothing and restores trigger focus", async ({ page, harness }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Switch front", exact: true });
  await trigger.click();
  await page.getByLabel("Who is fronting now?").selectOption(harness.profiles[1].id);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(harness.writes).toHaveLength(0);
});

test("@eval same-version newer front session rejects stale confirmation", async ({ page, harness }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Switch front", exact: true }).click();
  await page.getByLabel("Who is fronting now?").selectOption(harness.profiles[1].id);
  harness.currentFront!.id = "60000000-0000-4000-8000-000000000003";
  await page.getByRole("button", { name: "Confirm front switch", exact: true }).click();
  await expect(page.getByText("The front changed. Reload current front, choose again, and confirm.")).toBeVisible();
  expect(harness.switchCount).toBe(0);
  await page.getByRole("button", { name: "Reload current front" }).click();
  await page.getByLabel("Who is fronting now?").selectOption(harness.profiles[1].id);
  await page.getByRole("button", { name: "Confirm front switch", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Test Finch is now the recorded current front.");
  expect(harness.switchCount).toBe(1);
});

test("@eval front switch handles pagination and no current front", async ({ page, harness }) => {
  harness.profilePageSize = 1;
  harness.currentFront = null;
  harness.session = null;
  await page.goto("/");
  await page.getByRole("button", { name: "Switch front", exact: true }).click();
  await page.getByLabel("Who is fronting now?").selectOption(harness.profiles[1].id);
  expect(harness.profileReads).toBe(2);
  await page.getByRole("button", { name: "Confirm front switch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Test Finch" })).toBeVisible();
  expect(harness.writes[0].body.expectedCurrentVersion).toBe(null);
  expect(harness.writes[0].body.expectedCurrentSessionId).toBe(null);
});

test("@eval missing profiles and unauthenticated switch reads cannot write", async ({ page, harness }) => {
  harness.switchReadStatus = 401;
  await page.goto("/");
  await page.getByRole("button", { name: "Switch front", exact: true }).click();
  await expect(page.getByText("Sign in to access private records.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Who is fronting now?")).toHaveCount(0);
  harness.switchReadStatus = 200;
  harness.profiles = [];
  await page.getByRole("button", { name: "Reload current front" }).click();
  await expect(page.getByText("No profiles are available. Add a profile before switching.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm front switch", exact: true })).toBeDisabled();
  expect(harness.writes).toHaveLength(0);
});

test("@eval ambiguous switch retry reuses the receipt and applies exactly once", async ({ page, harness }) => {
  harness.loseSwitchResponse = true;
  await page.goto("/");
  await page.getByRole("button", { name: "Switch front", exact: true }).click();
  await page.getByLabel("Who is fronting now?").selectOption(harness.profiles[1].id);
  await page.getByRole("button", { name: "Confirm front switch", exact: true }).click();
  await expect(page.getByText(/The switch may have been recorded/)).toBeVisible();
  await expect(page.getByLabel("Who is fronting now?")).toBeDisabled();
  await page.getByRole("button", { name: "Retry confirmed switch" }).click();
  await expect(page.getByRole("status")).toHaveText("Test Finch is now the recorded current front.");
  expect(harness.writes).toHaveLength(2);
  expect(harness.writes[1].requestId).toBe(harness.writes[0].requestId);
  expect(harness.switchCount).toBe(1);
});

test("@eval rapid confirmations cannot create duplicate switches", async ({ page, harness }) => {
  harness.switchDelay = 300;
  await page.goto("/");
  await page.getByRole("button", { name: "Switch front", exact: true }).click();
  await page.getByLabel("Who is fronting now?").selectOption(harness.profiles[1].id);
  const form = page.locator("#front-switch-form form");
  await form.evaluate((element) => {
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("status")).toHaveText("Test Finch is now the recorded current front.");
  expect(harness.writes).toHaveLength(1);
  expect(harness.switchCount).toBe(1);
});

test("@eval loading is truthful and late catch-up reads cannot undo a confirmed switch", async ({ page, harness }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/catch-up/current", async (route) => {
    await gate;
    await route.fulfill({ json: { data: fixtureSession } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Loading catch-up" })).toBeVisible();
  await expect(page.getByText("Current front · confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nothing in this view needs your eyes.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Switch front", exact: true }).click();
  await page.getByLabel("Who is fronting now?").selectOption(harness.profiles[1].id);
  await page.getByRole("button", { name: "Confirm front switch", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Test Finch" })).toBeVisible();
  const response = page.waitForResponse("**/api/v1/catch-up/current");
  release();
  await (await response).finished();
  await expect(page.getByRole("heading", { name: "Welcome back, Test Finch" })).toBeVisible();
});
