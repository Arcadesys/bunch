import { expect, test } from "./fixtures";

test("operator can expand an open pilot by three with fresh evidence", async ({ page }, info) => {
  const submissions: unknown[] = [];

  await page.route("**/api/v1/account", (route) => route.fulfill({
    json: { data: { state: "ACTIVE", role: "OPERATOR", canManageTenantInvitations: true, emailVerified: true, usedBytes: 0, quotaBytes: 0 } },
  }));
  await page.route("**/api/v1/account/invitations", (route) => route.fulfill({
    json: { data: [], activation: { open: true, maxFriends: 3 } },
  }));
  await page.route("**/api/v1/account/invitations/activate", async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({ json: { data: { open: true, maxFriends: 6 } } });
  });

  await page.goto("/account");
  await page.getByText("Increase pilot capacity by 3", { exact: true }).click();
  await expect(page.getByText("New capacity:")).toContainText("6");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(await page.getByText("Increase pilot capacity by 3", { exact: true }).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath("pilot-capacity-expansion.png"), fullPage: true });
  await page.getByLabel("When did you verify capacity for 6 systems?").fill("2026-09-19T12:00");
  await page.getByLabel("Capacity evidence").fill("Six isolated systems fit within the checked service allowances.");
  await page.getByLabel("Recovery evidence").fill("Encrypted seven-day backup restored successfully in the checked recovery test.");
  await page.getByLabel("I verified capacity for 6 private systems.").check();
  await page.getByLabel("I verified encrypted recovery and a restore test in the last seven days.").check();
  await page.getByRole("button", { name: "Record evidence and increase capacity to 6" }).click();

  await expect(page.getByRole("status")).toContainText("Pilot capacity increased to 6 private systems.");
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    slots: 6,
    capacityConfirmed: true,
    recoveryConfirmed: true,
  });
});
