import { test, expect } from "@playwright/test";

const fresh = {
  state: "NOT_ENROLLED",
  signedIn: true,
  emailVerified: true,
  usedBytes: 0,
  quotaBytes: 52428800,
};
test("@eval friend accepts privacy and invitation without recording any front", async ({
  page,
}, info) => {
  let enrolled = false;
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v1/account", (r) =>
    r.fulfill({
      json: {
        data: enrolled
          ? {
              ...fresh,
              state: "ACTIVE",
              displayName: "Fixture system",
              role: "FRIEND",
            }
          : fresh,
      },
    }),
  );
  await page.route("**/api/v1/pilot/accept", async (r) => {
    writes.push(r.request().url());
    expect(r.request().postDataJSON()).toEqual({
      token: "a".repeat(43),
      displayName: "Fixture system",
      privacyAccepted: true,
    });
    enrolled = true;
    await r.fulfill({ json: { data: { state: "ACTIVE" } } });
  });
  await page.goto("/join");
  await expect(
    page.getByRole("heading", { name: "Join the Bunch friends pilot" }),
  ).toBeVisible();
  await page.getByText("How catch-up and deletion work", { exact: true }).click();
  await expect(page.getByText(/Generated catch-up summaries are saved privately for 30 days/)).toBeVisible();
  await page.getByText("How catch-up and deletion work", { exact: true }).click();
  await page.getByLabel("Invitation code").fill("a".repeat(43));
  await page.getByLabel("System display name").fill("Fixture system");
  await page.getByRole("button", { name: "Accept invitation" }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("status")).toContainText(
    "private system account is ready",
  );
  await expect(page.getByText("Account status: ACTIVE")).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: info.outputPath("pilot-accepted.png"),
    fullPage: true,
  });
});
test("@eval failed invitation preserves draft and supports large-text reflow", async ({
  page,
}, info) => {
  await page.route("**/api/v1/account", (r) =>
    r.fulfill({ json: { data: fresh } }),
  );
  await page.route("**/api/v1/pilot/accept", (r) =>
    r.fulfill({
      status: 403,
      json: {
        error: {
          message: "This invitation is unavailable for this verified account.",
        },
      },
    }),
  );
  await page.goto("/join");
  await page.getByLabel("Invitation code").fill("b".repeat(43));
  await page.getByLabel("System display name").fill("Fixture");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("status")).toContainText("unavailable");
  await expect(page.getByLabel("System display name")).toHaveValue("Fixture");
  await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  await page.screenshot({
    path: info.outputPath("pilot-large-text.png"),
    fullPage: true,
  });
});
test("@eval export includes original image downloads and deletion requires exact confirmation", async ({
  page,
}) => {
  let state = "ACTIVE",
    deletes = 0;
  await page.route("**/api/v1/account", (r) =>
    r.fulfill({
      json: {
        data: { ...fresh, state, role: "FRIEND", displayName: "Fixture" },
      },
    }),
  );
  await page.route("**/api/v1/account/export", (r) =>
    r.fulfill({
      json: {
        formatVersion: 1,
        data: {},
        images: [
          {
            id: "fixture-image",
            downloadUrl: "/api/v1/account/images/fixture-image",
          },
        ],
      },
    }),
  );
  await page.route("**/api/v1/account/delete", (r) => {
    expect(r.request().postDataJSON()).toEqual({
      confirmation: "DELETE MY SYSTEM",
    });
    deletes++;
    state = deletes === 1 ? "DELETING" : "DELETED";
    return r.fulfill({
      status: deletes === 1 ? 202 : 200,
      json: { data: { state, retryable: deletes === 1 } },
    });
  });
  await page.goto("/account");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export records and image list" })
    .click();
  expect((await download).suggestedFilename()).toBe("bunch-records.json");
  await expect(
    page.getByRole("link", { name: "Download original image 1" }),
  ).toBeVisible();
  await page.getByText("Delete this system’s account", { exact: true }).click();
  await page
    .getByRole("button", { name: "Permanently delete my system" })
    .click();
  expect(deletes).toBe(0);
  await page.getByLabel("Type DELETE MY SYSTEM").fill("DELETE MY SYSTEM");
  await page
    .getByRole("button", { name: "Permanently delete my system" })
    .click();
  await expect(page.getByRole("status")).toContainText("pending");
  await page.getByRole("button", { name: "Retry deletion" }).click();
  await expect(page.getByRole("status")).toContainText("have been deleted");
  expect(deletes).toBe(2);
});
test("@eval signed-out join and client instructions never claim account access", async ({
  page,
}) => {
  await page.route("**/api/v1/account", (r) =>
    r.fulfill({ status: 401, json: { error: { message: "Sign in" } } }),
  );
  await page.goto("/join");
  await expect(
    page.getByRole("link", { name: "Sign in with Google" }),
  ).toBeVisible();
  await expect(page.getByText("Account status: ACTIVE")).toHaveCount(0);
  await page.getByRole("link", { name: "Connect clients" }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your private Bunch account" }),
  ).toBeVisible();
  await expect(
    page.getByText(/only messages it can actually access/),
  ).toBeVisible();
});
