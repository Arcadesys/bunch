import { test, expect } from "./fixtures";

const profiles = [
  { id: "test-robin", name: "Test Robin", selfDescribedGender: "Robin's description", description: "First profile", version: 1, images: [], profilePicture: null },
  { id: "test-finch", name: "Test Finch", selfDescribedGender: "Finch's description", description: "Second profile", version: 1, images: [], profilePicture: null },
];

test("profiles show the lineup before editing and save the chosen profile", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/api/system", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { profile: profiles[1] } });
    }
    return route.fulfill({ json: { profiles, currentFront: null, assignments: [] } });
  });
  await page.goto("/profiles");
  await expect(page.getByRole("heading", { name: "Profile lineup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Robin", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test Finch", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Bunch navigation" }).getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
  await page.getByText("Manage Test Finch’s profile and pictures", { exact: true }).click();
  await page.getByRole("button", { name: "Edit Test Finch’s details" }).click();
  const reflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(reflow.scroll, "Expanded profile editor must fit the viewport").toBeLessThanOrEqual(reflow.client + 1);
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Test Finch");
  await expect(page.getByRole("textbox", { name: "Self-described gender" })).toHaveValue("Finch's description");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Test Finch revised");
  await page.getByRole("button", { name: "Save profile changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved privately.");
  expect(writes).toEqual([{ action: "saveProfile", profileId: "test-finch", profile: { name: "Test Finch revised", selfDescribedGender: "Finch's description", description: "Second profile" } }]);
});

test("unavailable profiles do not assert empty records and retry restores the lineup", async ({ page }) => {
  let status = 401;
  await page.route("**/api/system", (route) => route.fulfill({ status, json: status === 401 ? { error: "Sign in to access private records." } : { profiles, currentFront: null, assignments: [] } }));
  await page.goto("/profiles");
  await expect(page.getByRole("status")).toHaveText("Sign in to access private records.");
  await expect(page.getByText("No current front is recorded.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Profile lineup" })).toHaveCount(0);
  await expect(page.getByText("No profiles are recorded yet.", { exact: false })).toHaveCount(0);
  status = 200;
  await page.getByRole("button", { name: "Retry loading profiles" }).click();
  await expect(page.getByRole("heading", { name: "Profile lineup" })).toBeVisible();
  await expect(page.getByText("No current front is recorded.", { exact: true })).toHaveCount(0);
});


test("adding a profile stays a create when another profile editor is open", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/system", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: { profiles, currentFront: null, assignments: [] } });
  });
  await page.goto("/profiles");
  const add = page.locator("details").filter({ has: page.locator("summary", { hasText: /^Add a private profile$/ }) });
  await add.locator("summary").click();
  await add.getByRole("textbox", { name: "Name", exact: true }).fill("Test Wren");
  await page.getByText("Manage Test Finch’s profile and pictures", { exact: true }).click();
  await page.getByRole("button", { name: "Edit Test Finch’s details" }).click();
  const reflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(reflow.scroll, "Expanded profile editor must fit the viewport").toBeLessThanOrEqual(reflow.client + 1);
  await add.getByRole("button", { name: "Add private profile", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved privately.");
  expect(writes).toEqual([{ action: "saveProfile", profile: { name: "Test Wren", selfDescribedGender: "", description: "" } }]);
});
