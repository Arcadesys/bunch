import { test, expect } from "./fixtures";

const profiles = [
  { id: "test-robin", name: "Test Robin", selfDescribedGender: "Robin's description", description: "First profile", version: 1, images: [], profilePicture: null },
  { id: "test-finch", name: "Test Finch", selfDescribedGender: "Finch's description", description: "Second profile", version: 1, images: [], profilePicture: null },
];

test("profiles show the lineup before editing and save the chosen profile", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/api/v1/alters/test-finch", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { ...profiles[1], appearanceReferenceImageIds: [] } } });
    expect(route.request().method()).toBe("PATCH");
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: profiles[1] } });
  });
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
  expect(writes).toEqual([expect.objectContaining({ name: "Test Finch revised", selfDescribedGender: "Finch's description", description: "Second profile", expectedVersion: 1, species: "", signatureTraits: [] })]);
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
  await expect(page.getByRole("heading", { name: "Test Robin", exact: true })).toBeVisible();
});


test("adding a profile stays a create when another profile editor is open", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/v1/alters", async (route) => {
    expect(route.request().method()).toBe("POST");
    writes.push(route.request().postDataJSON());
    return route.fulfill({ json: { data: {} } });
  });
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
  expect(writes).toEqual([expect.objectContaining({ name: "Test Wren", selfDescribedGender: "", description: "", species: "", signatureTraits: [] })]);
  expect(writes[0]).not.toHaveProperty("expectedVersion");
});

test("visual identity retains failed edits, retries with the same ID, saves and reloads", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text()); });
  const profile = { ...profiles[0], species: "hare", visualDescription: "Indigo-and-violet hare; glasses.", signatureTraits: ["long glorious ears"], styleTags: ["moonlit"], imageDoNotChange: ["species", "palette", "glasses"] };
  const writes: Array<{ requestId?: string; body: Record<string, unknown> }> = [];
  let fail = true;
  await page.route("**/api/system", (route) => route.fulfill({ json: { profiles: [profile], currentFront: null, assignments: [] } }));
  await page.route("**/api/v1/alters/test-robin", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { ...profile, appearanceReferenceImageIds: [] } } });
    const body = route.request().postDataJSON();
    writes.push({ requestId: route.request().headers()["idempotency-key"], body });
    if (fail) return route.fulfill({ status: 503, json: { error: { message: "Temporary save failure" } } });
    Object.assign(profile, body, { version: profile.version + 1 });
    return route.fulfill({ json: { data: profile } });
  });
  await page.goto("/profiles");
  await expect(page).toHaveURL(/\/profiles$/);
  await expect(page).toHaveTitle(/Bunch/);
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();
  await page.getByLabel("Search profiles").fill("moonlit");
  await expect(page.getByRole("heading", { name: "Test Robin", exact: true })).toBeVisible();
  await page.getByText("Manage Test Robin’s profile and pictures", { exact: true }).click();
  await page.getByRole("button", { name: "Edit Test Robin’s details" }).click();
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await expect(page.getByRole("group", { name: "Visual identity", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Species", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("textbox", { name: "Visual description", exact: true })).toBeFocused();
  await page.getByRole("textbox", { name: "Visual description", exact: true }).fill("Elegant indigo-and-violet hare; glasses; nocturnal, composed, dark layered clothing.");
  await page.getByRole("textbox", { name: "Signature traits" }).fill("glasses\nlong glorious ears\ncotton tail");
  await page.getByRole("button", { name: "Save profile changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Temporary save failure");
  await expect(page.getByRole("textbox", { name: "Signature traits" })).toHaveValue("glasses\nlong glorious ears\ncotton tail");
  fail = false;
  await page.getByRole("button", { name: "Save profile changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved privately.");
  expect(writes[0].requestId).toBeTruthy();
  expect(writes[1].requestId).toBe(writes[0].requestId);
  expect(writes[1].body.expectedVersion).toBe(1);
  expect(writes[1].body.signatureTraits).toEqual(["glasses", "long glorious ears", "cotton tail"]);
  await page.getByRole("button", { name: "Edit Test Robin’s details" }).click();
  await expect(page.getByRole("textbox", { name: "Species", exact: true })).toHaveValue("hare");
  await expect(page.getByRole("textbox", { name: "Signature traits" })).toHaveValue("glasses\nlong glorious ears\ncotton tail");
  const size = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  const group = page.getByRole("group", { name: "Visual identity", exact: true });
  const contained = await group.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return [...element.querySelectorAll("label, input, textarea")].every((child) => {
      const rect = child.getBoundingClientRect();
      return rect.left >= box.left && rect.right <= box.right + 1;
    });
  });
  expect(contained, "Labels and controls must fit inside the visual identity fieldset").toBe(true);
  await group.evaluate((element) => element.scrollIntoView({ block: "start" }));
  if (testInfo.project.name === "desktop") await page.evaluate(() => window.scrollBy(0, -220));
  await page.screenshot({ path: `/tmp/bunch-visual-identity-${testInfo.project.name}.png` });
  expect(errors).toEqual([]);
});

test("conflicting visual profile edit keeps entries and explains recovery", async ({ page }) => {
  await page.route("**/api/system", (route) => route.fulfill({ json: { profiles, currentFront: null, assignments: [] } }));
  await page.route("**/api/v1/alters/test-robin", (route) => route.fulfill({ status: 409, json: { error: { message: "Conflict" } } }));
  await page.goto("/profiles");
  await page.getByText("Manage Test Robin’s profile and pictures", { exact: true }).click();
  await page.getByRole("button", { name: "Edit Test Robin’s details" }).click();
  await page.getByRole("textbox", { name: "Species", exact: true }).fill("hare");
  await page.getByRole("button", { name: "Save profile changes" }).click();
  await expect(page.getByRole("status")).toContainText("This profile changed since you opened it");
  await expect(page.getByRole("textbox", { name: "Species", exact: true })).toHaveValue("hare");
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
