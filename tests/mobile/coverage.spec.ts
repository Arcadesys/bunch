import { test, expect } from "./fixtures";

const profiles = [
  {
    id: "test-robin",
    name: "Test Robin",
    selfDescribedGender: "Robin's description",
    description: "First profile",
    version: 1,
    images: [],
    profilePicture: null,
  },
  {
    id: "test-finch",
    name: "Test Finch",
    selfDescribedGender: "Finch's description",
    description: "Second profile",
    version: 1,
    images: [],
    profilePicture: null,
  },
];

const assignments = [
  {
    id: "draft-1",
    ownerId: "owner",
    alterId: undefined,
    startsOn: "2026-09-27",
    endsOn: "2026-09-29",
    status: "DRAFT",
    reasons: ["Manual check-in: Test Robin", "Shared context mentioned schedule"],
    createdAt: "2026-09-26T10:00:00Z",
  },
  {
    id: "confirmed-1",
    ownerId: "owner",
    alterId: "test-finch",
    startsOn: "2026-09-20",
    endsOn: "2026-09-22",
    status: "CONFIRMED",
    reasons: [],
    createdAt: "2026-09-20T10:00:00Z",
  },
];

test("list shows draft + confirmed coverage", async ({ page }) => {
  await page.route("**/api/system", async (route) => {
    return route.fulfill({ json: { profiles, assignments } });
  });
  await page.goto("/coverage");
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  await expect(page.getByText("Drafts awaiting your decision")).toBeVisible();
  await expect(page.getByText("Confirmed coverage history")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2026-09-27 – 2026-09-29" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2026-09-20 – 2026-09-22" }).first()
  ).toBeVisible();
  await expect(page.getByText("Needs decision")).toBeVisible();
});

test("confirm button is disabled until a person is chosen, then posts resolveDraft", async ({
  page,
}) => {
  const writes: unknown[] = [];
  await page.route("**/api/system", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: { profiles, assignments } });
  });
  await page.goto("/coverage");
  await page
    .getByRole("button", { name: "2026-09-27 – 2026-09-29" })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "2026-09-27 – 2026-09-29" })).toBeVisible();
  const confirmButton = page.getByRole("button", { name: "Confirm coverage record" });
  await expect(confirmButton).toBeDisabled();
  await page.getByRole("combobox", { name: "Record this as" }).selectOption("test-finch");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  await expect(page.getByRole("status")).toContainText("Coverage confirmed and saved");
  expect(writes).toContainEqual(
    expect.objectContaining({
      action: "resolveDraft",
      resolution: expect.objectContaining({
        draftId: "draft-1",
        result: "CONFIRMED",
        alterId: "test-finch",
      }),
    })
  );
});

test("creating a draft posts exact createDraft body", async ({ page }) => {
  const writes: unknown[] = [];
  await page.route("**/api/system", async (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { profiles, assignments: [] } });
    }
    return route.fulfill({ json: { profiles, assignments: [] } });
  });
  await page.goto("/coverage");
  await page.getByRole("button", { name: "Create a coverage draft" }).click();
  await expect(page.getByRole("heading", { name: "Coverage draft" })).toBeVisible();
  const startInput = page.getByRole("textbox", { name: "Starts on" });
  const endInput = page.getByRole("textbox", { name: "Ends on" });
  const checkInSelect = page.getByRole("combobox", { name: "Manual check-in" });
  const contextTextarea = page.getByRole("textbox", { name: /Shared ChatGPT context/ });

  // Set values
  const today = new Date().toISOString().slice(0, 10);
  await startInput.fill(today);
  await endInput.fill("2026-09-30");
  await checkInSelect.selectOption("test-robin");
  await contextTextarea.fill("Test context for coverage");

  await page.getByRole("button", { name: "Create coverage draft" }).click();
  await expect(page.getByRole("status")).toContainText("Coverage draft created");

  expect(writes).toContainEqual(
    expect.objectContaining({
      action: "createDraft",
      draft: expect.objectContaining({
        startsOn: today,
        endsOn: "2026-09-30",
        manualAlterId: "test-robin",
        sharedContext: "Test context for coverage",
      }),
    })
  );
});

test("load failure shows error and retry works", async ({ page }) => {
  let status = 401;
  await page.route("**/api/system", (route) =>
    route.fulfill({
      status,
      json: status === 401 ? { error: "Sign in to access coverage." } : { profiles, assignments },
    })
  );
  await page.goto("/coverage");
  await expect(page.getByRole("status")).toContainText("Sign in to access coverage.");
  await expect(page.getByText("Drafts awaiting your decision")).toHaveCount(0);
  status = 200;
  await page.getByRole("button", { name: "Retry loading coverage" }).click();
  await expect(page.getByRole("heading", { name: "Coverage" })).toBeVisible();
  await expect(page.getByText("Drafts awaiting your decision")).toBeVisible();
});

test("no horizontal scroll at phone and desktop viewports", async ({ page }) => {
  await page.route("**/api/system", async (route) => {
    return route.fulfill({ json: { profiles, assignments } });
  });
  await page.goto("/coverage");
  const reflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(reflow.scroll, "Coverage list must fit without horizontal scroll").toBeLessThanOrEqual(
    reflow.client + 1
  );

  // Open a draft detail
  await page
    .getByRole("button", { name: "2026-09-27 – 2026-09-29" })
    .first()
    .click();
  const reflowDetail = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(
    reflowDetail.scroll,
    "Coverage detail must fit without horizontal scroll"
  ).toBeLessThanOrEqual(reflowDetail.client + 1);
});
