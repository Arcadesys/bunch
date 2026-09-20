import { test, expect } from "./fixtures";

test("Home routes through Options to account invitations", async ({ page }, info) => {
  await page.route("**/api/v1/account", route => route.fulfill({
    json: { data: { state: "LEGACY", canManageTenantInvitations: true, emailVerified: true, usedBytes: 0, quotaBytes: 0 } },
  }));
  await page.route("**/api/v1/account/invitations", route => route.fulfill({
    json: { data: [], activation: { open: false, maxFriends: 3, reason: "Record current capacity and recovery evidence before opening invitations." } },
  }));

  await page.goto("/home");
  await page.getByText("More places", { exact: true }).click();
  await page.getByRole("navigation", { name: "More places" }).getByRole("link", { name: "Options", exact: true }).click();
  const invite = page.getByRole("link", { name: "Account & privacy", exact: false });
  await expect(invite).toBeVisible();
  expect(await invite.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
  await page.screenshot({ path: info.outputPath("home-invite-action.png"), fullPage: false });
  await invite.click();

  await expect(page).toHaveURL(/\/account$/);
  const heading = page.getByRole("heading", { name: "Invite a new private system", exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open invitations", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("tenant-invitation-navigation.png"), fullPage: false });
});
