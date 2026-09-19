import { expect, test } from "./fixtures";
test("operator can set zero or restore the pilot default", async ({ page }) => {
  await page.route("**/api/v1/account", r => r.fulfill({ json: { data: { state: "ACTIVE", role: "OPERATOR", canShareGallery: false } } }));
  const writes: unknown[] = [];
  await page.route("**/api/v1/account/image-allowances", r => {
    if (r.request().method() === "PATCH") { writes.push(r.request().postDataJSON()); return r.fulfill({ json: { data: { saved: true } } }); }
    return r.fulfill({ json: { data: [{ id: "synthetic-pilot", name: "Test pilot", role: "FRIEND", state: "ACTIVE", override: null }] } });
  });
  await page.goto("/account");
  const limit = page.getByRole("spinbutton", { name: /Test pilot/ });
  await limit.fill("0");
  await page.getByRole("button", { name: "Save allowance for Test pilot" }).click();
  await expect(page.getByText("Allowance saved for Test pilot.")).toBeVisible();
  await limit.fill("");
  await page.getByRole("button", { name: "Save allowance for Test pilot" }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes).toEqual([{ ownerId: "synthetic-pilot", limit: 0 }, { ownerId: "synthetic-pilot", limit: null }]);
});
test("pilot account cannot see operator allowance controls", async ({ page }) => {
  let queried = false;
  await page.route("**/api/v1/account", r => r.fulfill({ json: { data: { state: "ACTIVE", role: "FRIEND", canShareGallery: false } } }));
  await page.route("**/api/v1/account/image-allowances", r => { queried = true; return r.fulfill({ status: 403, json: {} }); });
  await page.goto("/account");
  await expect(page.getByText("Account status: ACTIVE")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pilot image allowances" })).toHaveCount(0);
  expect(queried).toBe(false);
});
