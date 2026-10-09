import { test, expect } from "./fixtures";

const friendAccount = {
  state: "ACTIVE",
  role: "FRIEND",
  displayName: "Storage test system",
  emailVerified: true,
  usedBytes: 35 * 1024 * 1024,
  quotaBytes: 100 * 1024 * 1024,
};

test("account explains stored-image capacity and links to both photo managers", async ({ page }, info) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: friendAccount } }));
  await page.route("**/api/v1/generated-images**", route => route.fulfill({ json: { data: [], meta: { nextCursor: null } } }));
  await page.goto("/account?id=account");

  await expect(page.getByRole("heading", { name: "Image storage" })).toBeVisible();
  await expect(page.getByText("Used 35.0 MiB of 100.0 MiB. 65.0 MiB remaining.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Storage includes profile photos and generated photos/)).toBeVisible();
  await expect(page.getByText(/deleting a stored image frees storage but does not return credits/)).toBeVisible();

  const profileLink = page.getByRole("link", { name: "Manage profile photos" });
  const generatedLink = page.getByRole("link", { name: "Manage generated photos" });
  await expect(profileLink).toHaveAttribute("href", "/gallery");
  await expect(generatedLink).toHaveAttribute("href", "/gallery/generated");
  const meter = page.getByRole("meter", { name: "Image storage used" });
  await expect(meter).toHaveAttribute("max", String(100 * 1024 * 1024));
  await expect(meter).toHaveAttribute("value", String(35 * 1024 * 1024));

  const is320 = page.viewportSize()?.width === 320;
  if (is320) await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
  const pressTabUntilFocused = async (link: typeof profileLink) => {
    for (let step = 0; step < 80; step += 1) {
      if (await link.evaluate(element => element === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(link).toBeFocused();
    expect(await link.evaluate(element => element.matches(":focus-visible"))).toBe(true);
    expect(await link.evaluate(element => parseFloat(getComputedStyle(element).minHeight))).toBeGreaterThanOrEqual(48);
    await link.evaluate(element => element.scrollIntoView({ block: "center", inline: "nearest" }));
    const unobscured = await link.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return hit === element || element.contains(hit);
    });
    expect(unobscured).toBe(true);
    if (is320) await page.screenshot({ path: info.outputPath("account-storage-focused-link-320-large-text.png"), fullPage: false });
    await link.click();
  };

  await pressTabUntilFocused(profileLink);
  await expect(page).toHaveURL(/\/gallery$/);
  await page.goto("/account?id=account");
  await expect(page.getByRole("heading", { name: "Image storage" })).toBeVisible();
  if (is320) await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
  const currentGeneratedLink = page.getByRole("link", { name: "Manage generated photos" });
  await pressTabUntilFocused(currentGeneratedLink);
  await expect(page).toHaveURL(/\/gallery\/generated$/);

  if (is320) {
    await page.goto("/account?id=account");
    await expect(page.getByRole("heading", { name: "Image storage" })).toBeVisible();
    await page.addStyleTag({ content: "html { font-size: 32px !important; }" });
    const summary = page.getByText("Used 35.0 MiB of 100.0 MiB. 65.0 MiB remaining.", { exact: true });
    await summary.evaluate(element => element.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: info.outputPath("account-storage-usage-320-large-text.png"), fullPage: false });
  }
});

test("near-full image storage reloads with the refreshed remaining capacity", async ({ page }) => {
  let usedBytes = 99 * 1024 * 1024;
  let accountReads = 0;
  await page.route("**/api/v1/account", route => {
    accountReads += 1;
    return route.fulfill({ json: { data: { ...friendAccount, usedBytes } } });
  });
  await page.goto("/account?id=account");
  await expect(page.getByText("Used 99.0 MiB of 100.0 MiB. 1.0 MiB remaining.", { exact: true })).toBeVisible();
  usedBytes = 80 * 1024 * 1024;
  await page.reload();
  await expect(page.getByText("Used 80.0 MiB of 100.0 MiB. 20.0 MiB remaining.", { exact: true })).toBeVisible();
  expect(accountReads).toBeGreaterThanOrEqual(2);
});

test("operator image storage remains exempt from a per-account quota", async ({ page }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { ...friendAccount, role: "OPERATOR", quotaBytes: 0 } } }));
  await page.goto("/account?id=account");
  await expect(page.getByRole("heading", { name: "Image storage" })).toBeVisible();
  await expect(page.getByText(/No per-account storage quota applies to the hosting operator/)).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(0);
});

test("zero-quota accounts show no meter while retaining photo management access", async ({ page }) => {
  await page.route("**/api/v1/account", route => route.fulfill({ json: { data: { ...friendAccount, usedBytes: 0, quotaBytes: 0 } } }));
  await page.goto("/account?id=account");
  await expect(page.getByRole("heading", { name: "Image storage" })).toBeVisible();
  await expect(page.getByText("No image storage is available for this account.")).toBeVisible();
  await expect(page.getByRole("meter")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Manage profile photos" })).toHaveAttribute("href", "/gallery");
  await expect(page.getByRole("link", { name: "Manage generated photos" })).toHaveAttribute("href", "/gallery/generated");
});
