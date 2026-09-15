import { test, expect } from "@playwright/test";

const operator = { signedIn: true, emailVerified: true, state: "ACTIVE", role: "OPERATOR", canManageTenantInvitations: true, displayName: "Owner fixture", usedBytes: 0, quotaBytes: 0 };
const recipient = { signedIn: true, emailVerified: true, state: "NOT_ENROLLED", usedBytes: 0, quotaBytes: 0 };

test("@eval operator creates a copied one-use tenant link and a separate browser redeems it once", async ({ browser }, info) => {
  const operatorContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const operatorPage = await operatorContext.newPage();
  const invitations: Array<{ id: string; status: string; expiresAt: string; createdAt: string }> = [];
  const token = "t".repeat(43);
  await operatorPage.route("**/api/v1/account", (route) => route.fulfill({ json: { data: operator } }));
  await operatorPage.route("**/api/v1/account/invitations", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: invitations, activation: { open: true, maxFriends: 4 } } });
    invitations.unshift({ id: "d37d1b95-4cf7-48f2-9b25-3ba2a53f3069", status: "AVAILABLE", expiresAt: "2026-09-15T12:00:00.000Z", createdAt: "2026-09-08T12:00:00.000Z" });
    return route.fulfill({ json: { data: { token } } });
  });
  await operatorPage.route("**/api/v1/account/invitations/*", async (route) => {
    invitations[0].status = "REVOKED";
    await route.fulfill({ status: 204 });
  });
  await operatorPage.goto("/account");
  await operatorPage.getByRole("button", { name: "Create and copy invitation link" }).click();
  await expect(operatorPage.getByRole("status")).toContainText("Invitation link copied");
  const link = await operatorPage.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link)).toMatchObject({ hostname: "127.0.0.1", pathname: "/join" });
  expect(new URL(link).hash).toBe(`#invite=${token}`);
  await operatorPage.screenshot({ path: info.outputPath("operator-invitations.png"), fullPage: true });

  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();
  let used = false;
  await recipientPage.route("**/api/v1/account", (route) => route.fulfill({ json: { data: used ? { ...recipient, state: "ACTIVE", role: "FRIEND", displayName: "Recipient fixture" } : recipient } }));
  await recipientPage.route("**/api/v1/pilot/accept", async (route) => {
    if (used) return route.fulfill({ status: 409, json: { error: { message: "This invitation has already been used." } } });
    expect(route.request().postDataJSON().token).toBe(token);
    used = true;
    return route.fulfill({ json: { data: { state: "ACTIVE", displayName: "Recipient fixture" } } });
  });
  await recipientPage.goto(link);
  await expect(recipientPage.getByLabel("Invitation code")).toHaveValue(token);
  await recipientPage.getByLabel("System display name").fill("Recipient fixture");
  await recipientPage.getByRole("checkbox").check();
  await recipientPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(recipientPage.getByText("Account status: ACTIVE")).toBeVisible();
  await recipientPage.screenshot({ path: info.outputPath("recipient-accepted.png"), fullPage: true });

  const reuseContext = await browser.newContext();
  const reusePage = await reuseContext.newPage();
  await reusePage.route("**/api/v1/account", (route) => route.fulfill({ json: { data: recipient } }));
  await reusePage.route("**/api/v1/pilot/accept", (route) => route.fulfill({ status: 409, json: { error: { message: "This invitation has already been used." } } }));
  await reusePage.goto(link);
  await reusePage.getByLabel("System display name").fill("Second system");
  await reusePage.getByRole("checkbox").check();
  await reusePage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(reusePage.getByRole("status")).toContainText("already been used");
  await operatorContext.close(); await recipientContext.close(); await reuseContext.close();
});
