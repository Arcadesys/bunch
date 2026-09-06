import { test, expect, fixtureSession } from "./fixtures";

async function open(page: import("@playwright/test").Page) {
  await page
    .getByRole("button", { name: "Update hosting or fronting", exact: true })
    .click();
  await expect(page.getByLabel("Experience change")).toBeVisible();
}

test("@eval explicit episode start leaves other episodes intact and opens selected catch-up", async ({
  page,
  harness,
}, testInfo) => {
  await page.goto("/");
  await open(page);
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  expect(harness.writes).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath("episode-confirmation.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Catch-up for Test Finch" }),
  ).toBeVisible();
  expect(harness.presence.fronting).toHaveLength(2);
  expect(harness.writes[0].body).toEqual({ alterId: harness.profiles[1].id });
  await page
    .getByRole("button", {
      name: "Catch up for Test Robin · fronting",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Catch-up for Test Robin" }),
  ).toBeVisible();
});

test("@eval cancelling writes nothing and restores focus", async ({
  page,
  harness,
}) => {
  await page.goto("/");
  await open(page);
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Update hosting or fronting",
      exact: true,
    }),
  ).toBeFocused();
  expect(harness.writes).toHaveLength(0);
});

test("@eval hosting and episode ends preserve independent records", async ({
  page,
  harness,
}) => {
  await page.goto("/");
  await open(page);
  await page.getByLabel("Experience change").selectOption("HOST");
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Catch up for Test Finch · hosting",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Catch-up for Test Robin" })).toBeVisible();
  expect(harness.presence.fronting).toHaveLength(1);
  await open(page);
  await page.getByLabel("Experience change").selectOption("END");
  await page
    .getByLabel("Episode to end")
    .selectOption(harness.presence.fronting[0].id);
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByText("No open fronting episodes are recorded."),
  ).toBeVisible();
  expect(harness.presence.hosting?.alterName).toBe("Test Finch");
  await open(page);
  await page.getByLabel("Experience change").selectOption("CLEAR");
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(page.getByText("No hosting period is recorded.")).toBeVisible();
});

test("@eval stale host version requires reread and explicit reconfirmation", async ({
  page,
  harness,
}) => {
  await page.goto("/");
  await open(page);
  await page.getByLabel("Experience change").selectOption("HOST");
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  harness.host = {
    id: crypto.randomUUID(),
    alterId: null,
    alterName: null,
    version: 1,
    recordedAt: new Date().toISOString(),
  };
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByText("The record changed. Reload, choose again, and confirm."),
  ).toBeVisible();
  expect(harness.switchCount).toBe(0);
  await page
    .getByRole("button", { name: "Reload hosting and fronting" })
    .click();
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Catch-up for Test Robin" }),
  ).toBeVisible();
  expect(harness.writes[1].body.expectedVersion).toBe(1);
});

test("@eval ambiguous retry applies once and prevents changed input", async ({
  page,
  harness,
}) => {
  harness.loseSwitchResponse = true;
  await page.goto("/");
  await open(page);
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(page.getByText(/The change may be saved/)).toBeVisible();
  await expect(page.getByLabel("Experience change")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry confirmed change" }).click();
  await expect(
    page.getByRole("heading", { name: "Catch-up for Test Finch" }),
  ).toBeVisible();
  expect(harness.switchCount).toBe(1);
  expect(harness.writes[0].requestId).toBe(harness.writes[1].requestId);
});

test("@eval profiles paginate and failed reads do not enable mutations", async ({
  page,
  harness,
}) => {
  harness.profilePageSize = 1;
  harness.switchReadStatus = 401;
  await page.goto("/");
  await page
    .getByRole("button", { name: "Update hosting or fronting", exact: true })
    .click();
  await expect(page.getByLabel("Experience change")).toHaveCount(0);
  harness.switchReadStatus = 200;
  await page
    .getByRole("button", { name: "Reload hosting and fronting" })
    .click();
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  expect(harness.profileReads).toBeGreaterThanOrEqual(3);
  expect(harness.writes).toHaveLength(0);
});

test("@eval rapid confirmation sends one mutation", async ({
  page,
  harness,
}) => {
  harness.switchDelay = 250;
  await page.goto("/");
  await open(page);
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  await page.locator(".command-switch form").evaluate((form) => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await expect(
    page.getByRole("heading", { name: "Catch-up for Test Finch" }),
  ).toBeVisible();
  expect(harness.writes).toHaveLength(1);
});

test("@eval late initial catch-up cannot undo selected episode", async ({
  page,
  harness,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/catch-up/current", async (route) => {
    await gate;
    await route.fulfill({ json: { data: fixtureSession } });
  });
  await page.goto("/");
  await open(page);
  await page
    .getByLabel("Profile", { exact: true })
    .selectOption(harness.profiles[1].id);
  await page
    .getByRole("button", { name: "Confirm change", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Catch-up for Test Finch" }),
  ).toBeVisible();
  const response = page.waitForResponse("**/api/v1/catch-up/current");
  release();
  await (await response).finished();
  await expect(
    page.getByRole("heading", { name: "Catch-up for Test Finch" }),
  ).toBeVisible();
});

test("@eval controls are reachable before catch-up items and show both records", async ({ page, harness }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) errors.push(message.text()); });
  await page.goto("/");
  await expect(page).toHaveURL("http://127.0.0.1:3217/");
  await expect(page).toHaveTitle(/your private companion/);
  const shortcut = page.getByRole("navigation", { name: "Things you can do" }).getByRole("link", { name: "Hosting & fronting" });
  await expect(shortcut).toBeInViewport();
  await shortcut.click();
  const trigger = page.getByRole("button", { name: "Update hosting or fronting", exact: true });
  await expect(trigger).toBeInViewport();
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Experience change")).toBeVisible();
  await expect(page.getByLabel("Current recorded state")).toContainText("Current host: Not recorded");
  await expect(page.getByLabel("Current recorded state")).toContainText("Active fronting: Test Robin");
  expect(harness.writes).toHaveLength(0);
  await page.getByRole("heading", { name: "Confirm hosting or fronting" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("web-presence-controls.png"), fullPage: false });
  expect(errors).toEqual([]);
});

test("@eval saved change with failed reread retries reads without another mutation", async ({ page, harness }) => {
  await page.goto("/");
  await open(page);
  await page.getByLabel("Profile", { exact: true }).selectOption(harness.profiles[1].id);
  let failRead = true;
  let reads = 0;
  await page.route("**/api/v1/presence/current", async route => {
    reads += 1;
    if (failRead) await route.fulfill({ status: 503, json: { error: { message: "Temporary read failure" } } });
    else await route.fallback();
  });
  await page.getByRole("button", { name: "Confirm change", exact: true }).click();
  await expect(page.getByText(/Your change was saved, but current records could not be read/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  expect(harness.writes).toHaveLength(1);
  expect(harness.presence.fronting).toHaveLength(2);
  failRead = false;
  await page.getByRole("button", { name: "Retry reading saved records" }).click();
  await expect(page.getByRole("heading", { name: "Catch-up for Test Finch" })).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(harness.writes).toHaveLength(1);
  await page.reload();
  await open(page);
  await expect(page.getByLabel("Current recorded state")).toContainText("Test Finch");
  expect(harness.writes).toHaveLength(1);
});
