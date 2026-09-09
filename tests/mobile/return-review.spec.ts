import { test, expect } from "./fixtures";

test("saved review identifies memory gaps and reading makes no writes", async ({ page, harness }, testInfo) => {
  await page.route("**/api/v1/catch-up/review?*", route => route.fulfill({ json: { data: { revision: 1, review: {
    id: "70000000-0000-4000-8000-000000000001", alterId: harness.session!.alterId,
    summary: "Overview\nA four-month review.\n\nWhat needs attention now\nRead the open note.\n\nSignificant changes during the gap\nA recorded decision changed.",
    coverage: "ChatGPT memory was unavailable. Bunch records cover this interval; other conversations are a coverage gap.",
    sourceClient: "ChatGPT", sourceReferences: [{kind:"DIDDY",reference:"Synthetic note"},{kind:"MEMORY",reference:"Unavailable"}],
    createdAt: "2026-09-06T01:00:00Z", expiresAt:"2026-10-06T01:00:00Z"
  } } } }));
  await page.goto("/home");
  await page.getByText("More: saved review and coverage", { exact: true }).click();
  await expect(page.getByText(/A four-month review/)).toBeVisible();
  await expect(page.getByText(/ChatGPT memory was unavailable/)).toBeVisible();
  expect(harness.writes).toHaveLength(0);
  await page.getByRole("button", {name:"Refresh saved review"}).click();
  await expect(page.getByText(/A four-month review/)).toBeVisible();
  expect(harness.writes).toHaveLength(0);
  await page.screenshot({path:testInfo.outputPath("saved-return-review.png"),fullPage:true});
});

test("missing review shows records and no generation status", async ({page}) => {
  await page.goto("/home");
  await page.getByText("More: saved review and coverage", { exact: true }).click();
  await expect(page.getByText("Review not yet saved.", {exact:true})).toBeVisible();
  await expect(page.getByRole("heading",{name:"Fixture todo",exact:true})).toBeVisible();
  await expect(page.getByText(/generating|generation in progress/i)).toHaveCount(0);
});
