import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test, expect } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
test.skip(!databaseUrl, "E2E_DATABASE_URL is required for the real local API flow.");
const ownerSubject = `e2e-owner-${randomUUID()}`;
const recipientSubject = `e2e-recipient-${randomUUID()}`;
const otherSubject = `e2e-other-${randomUUID()}`;
function localDateTime(value: Date) {
  const part = (number: number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}`;
}

test.beforeAll(async () => {
  const hostname = new URL(databaseUrl!).hostname;
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname)) throw new Error("E2E_DATABASE_URL must point to disposable local PostgreSQL.");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const ownerId = `auth0:${ownerSubject}`;
    await pool.query("insert into app_user(id,google_subject) values($1,$1)", [ownerId]);
    await pool.query("insert into alter_profile(owner_id,name) values($1,'Owner-only fixture')", [ownerId]);
    await pool.query("insert into invitation_operator(owner_id) values($1)", [ownerId]);
  } finally { await pool.end(); }
});

test("@eval real local API: normal entry opens invitations, creates/copies, redeems once, and isolates tenants", async ({ browser }, info) => {
  const ownerContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    extraHTTPHeaders: { "x-system-e2e-subject": ownerSubject },
  });
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto("/");
  await ownerPage.getByRole("link", { name: "Invite another system" }).click();
  await expect(ownerPage).toHaveURL(/\/account#tenant-invitations-heading$/);
  await expect(ownerPage.getByRole("heading", { name: "Invite a new private system" })).toBeVisible();
  await ownerPage.getByLabel("When did you verify this?").fill(localDateTime(new Date(Date.now() - 120_000)));
  await ownerPage.getByLabel("Capacity evidence").fill("Checked local capacity for three isolated systems.");
  await ownerPage.getByLabel("Recovery evidence").fill("Verified encrypted seven-day recovery and restore test.");
  await ownerPage.getByLabel(/I verified capacity/).check();
  await ownerPage.getByLabel(/I verified encrypted recovery/).check();
  await ownerPage.getByRole("button", { name: "Record evidence and open invitations" }).click();
  await expect(ownerPage.getByText("Invitations are open for the recorded capacity.")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Create and copy invitation link" }).click();
  await expect(ownerPage.getByText("Invitation link copied. It works once, expires in seven days, and is not redeemed by opening it.")).toBeVisible();
  const link = await ownerPage.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link)).toMatchObject({ hostname: "127.0.0.1", pathname: "/join" });
  expect(new URL(link).hash).toMatch(/^#invite=[A-Za-z0-9_-]{43}$/);
  await ownerPage.screenshot({ path: info.outputPath("real-operator-invitations.png"), fullPage: true });

  const recipientContext = await browser.newContext({ extraHTTPHeaders: { "x-system-e2e-subject": recipientSubject } });
  const recipientPage = await recipientContext.newPage();
  await recipientPage.goto(link);
  await recipientPage.getByLabel("System display name").fill("Recipient fixture");
  await recipientPage.getByRole("checkbox").check();
  await recipientPage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(recipientPage.getByText("Account status: ACTIVE")).toBeVisible();
  await recipientPage.screenshot({ path: info.outputPath("real-recipient-accepted.png"), fullPage: true });

  const reuseContext = await browser.newContext({ extraHTTPHeaders: { "x-system-e2e-subject": otherSubject } });
  const reusePage = await reuseContext.newPage();
  await reusePage.goto(link);
  await reusePage.getByLabel("System display name").fill("Second recipient");
  await reusePage.getByRole("checkbox").check();
  await reusePage.getByRole("button", { name: "Accept invitation" }).click();
  await expect(reusePage.getByRole("status")).toContainText("already been used");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const ownerId = `auth0:${ownerSubject}`, recipientId = `auth0:${recipientSubject}`;
    expect((await pool.query("select role,state from pilot_account where owner_id=$1", [ownerId])).rows[0]).toMatchObject({ role: "OPERATOR", state: "ACTIVE" });
    expect((await pool.query("select role,state from pilot_account where owner_id=$1", [recipientId])).rows[0]).toMatchObject({ role: "FRIEND", state: "ACTIVE" });
    expect((await pool.query("select count(*)::int as count from alter_profile where owner_id=$1", [recipientId])).rows[0].count).toBe(0);
    expect((await pool.query("select count(*)::int as count from pilot_invitation where accepted_by=$1", [recipientId])).rows[0].count).toBe(1);
  } finally { await pool.end(); }
  await ownerContext.close(); await recipientContext.close(); await reuseContext.close();
});
