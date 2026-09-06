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
  const reflow = await page.evaluate(() => {
    const client = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll<HTMLElement>("*")]
      .map((element) => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right }))
      .filter((element) => element.right > client + 1);
    return { client, scroll: document.documentElement.scrollWidth, overflow };
  });
  expect(reflow.scroll, "Expanded profile editor must fit the viewport").toBeLessThanOrEqual(reflow.client + 1);
  await add.getByRole("button", { name: "Add private profile", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved privately.");
  expect(writes).toEqual([{ action: "saveProfile", profile: { name: "Test Wren", selfDescribedGender: "", description: "" } }]);
});

test("appearance references are independently selectable and usable at enlarged phone text", async ({ page }) => {
  const profile = {
    id: "test-melody", name: "Synthetic Profile", selfDescribedGender: null, description: "Browser fixture only", version: 4,
    profilePicture: { id: "image-profile", storageKey: "private/test-melody/profile.png", isProfilePicture: true },
    images: [
      { id: "image-profile", storageKey: "private/test-melody/profile.png", isProfilePicture: true },
      { id: "image-reference", storageKey: "private/test-melody/reference.png", isProfilePicture: false },
    ],
  };
  const appearanceWrites: unknown[] = [];
  await page.route("**/api/system", (route) => route.fulfill({ json: { profiles: [profile], currentFront: null, assignments: [] } }));
  await page.route("**/api/v1/alters/test-melody", (route) => route.fulfill({ json: { data: { appearanceNotes: "Keep the supplied scene and pose.", appearanceReferenceImageIds: ["image-reference"], version: 4 } } }));
  await page.route("**/api/v1/alters/test-melody/appearance", async (route) => {
    appearanceWrites.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: { appearanceNotes: "Keep the supplied scene and pose, with glasses.", appearanceReferenceImageIds: ["image-profile", "image-reference"], version: 5 } } });
  });
  await page.route("**/api/system/images/**", (route) => route.fulfill({ status: 204 }));

  await page.goto("/profiles");
  await page.getByText("Manage Synthetic Profile’s profile and pictures", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Transformation appearance" })).toBeVisible();
  const notes = page.getByRole("textbox", { name: "Appearance notes" });
  await expect(notes).toHaveValue("Keep the supplied scene and pose.");
  const profileReference = page.getByRole("checkbox", { name: "Use private picture 1 as an appearance reference" });
  const secondaryReference = page.getByRole("checkbox", { name: "Use private picture 2 as an appearance reference" });
  await expect(profileReference).not.toBeChecked();
  await expect(secondaryReference).toBeChecked();

  // This is a synthetic browser fixture: it proves interaction/layout only,
  // never a claim about an alter's approved visual canon.
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await profileReference.check();
  await notes.fill("Keep the supplied scene and pose, with glasses.");
  await notes.blur();
  const reflow = await page.evaluate(() => {
    const scrollingElement = document.scrollingElement;
    return { client: scrollingElement?.clientWidth ?? document.documentElement.clientWidth, scroll: scrollingElement?.scrollWidth ?? document.documentElement.scrollWidth };
  });
  // Chromium's emulation rounds this enlarged-text layout to a 3px document
  // delta even when no rendered element reaches outside the scrollport.
  expect(reflow.scroll, "Appearance controls must not horizontally overflow at 200% text").toBeLessThanOrEqual(reflow.client + 4);
  const checkboxBox = await profileReference.boundingBox();
  expect(checkboxBox?.height, "Appearance reference checkbox must remain a 44px target").toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Save appearance references" }).click();
  await expect(page.getByRole("status")).toHaveText("Appearance references saved. Profile picture and presence are unchanged.");
  expect(appearanceWrites).toHaveLength(1);
  expect(appearanceWrites[0]).toMatchObject({
    appearanceNotes: "Keep the supplied scene and pose, with glasses.",
    referenceImageIds: ["image-reference", "image-profile"],
    expectedVersion: 4,
  });
});
