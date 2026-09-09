import { test, expect } from "./fixtures";

test("Home has a distinct, accessible path to tenant invitations", async ({ page }, info) => {
  await page.route("**/api/v1/account", route => route.fulfill({
    json: { data: { state: "LEGACY", canManageTenantInvitations: true, emailVerified: true, usedBytes: 0, quotaBytes: 0 } },
  }));
  await page.route("**/api/v1/account/invitations", route => route.fulfill({
    json: { data: [], activation: { open: false, maxFriends: 3, reason: "Record current capacity and recovery evidence before opening invitations." } },
  }));

  await page.goto("/");
  const invite = page.getByRole("link", { name: "Invite another system", exact: true });
  await expect(invite).toBeVisible();
  expect(await invite.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(64);
  await page.screenshot({ path: info.outputPath("home-invite-action.png"), fullPage: false });
  await invite.click();

  await expect(page).toHaveURL(/\/account#tenant-invitations-heading$/);
  const heading = page.getByRole("heading", { name: "Invite a new private system", exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole("heading", { name: "Open invitations", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath("tenant-invitation-navigation.png"), fullPage: false });
});
