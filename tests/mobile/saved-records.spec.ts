import { test, expect } from "./fixtures";

test("saved records remain available without a catch-up; addressed note survives reload", async ({ page, harness }) => {
  harness.session = null;
  harness.currentFront = null;
  await page.goto("/notes");
  await expect(page.getByRole("article")).toContainText("Fixture note");
  await page.getByLabel("Note", { exact: true }).fill("Remember the studio booking");
  await page.getByRole("combobox", { name: "Recipient", exact: true }).selectOption(harness.profiles[1].id);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("article").filter({ hasText: "Remember the studio booking" })).toBeVisible();
  expect(harness.writes[0].body.alterId).toBe(harness.profiles[1].id);
  await page.reload();
  await expect(page.getByRole("article").filter({ hasText: "Remember the studio booking" })).toBeVisible();
  expect(harness.currentFront).toBeNull();
  expect(harness.session).toBeNull();
});

test("assigned todo is immediately visible; completing it is distinct from reviewing catch-up", async ({ page, harness }) => {
  await page.goto("/board");
  await page.getByLabel("Title", { exact: true }).fill("Print the fit coupon");
  await page.getByRole("checkbox", { name: "Test Finch", exact: true }).check();
  await page.getByRole("button", { name: "Save todo", exact: true }).click();
  const todo = page.getByRole("article").filter({ hasText: "Print the fit coupon" });
  await expect(todo).toContainText("Assigned to: Test Finch");
  expect(harness.writes[0].body.assigneeAlterIds).toEqual([harness.profiles[1].id]);
  await todo.getByRole("button", { name: "Mark todo complete" }).click();
  await expect(todo.getByRole("button", { name: "Reopen todo" })).toBeVisible();
  expect(harness.writes[1].body).toEqual({ expectedVersion: 1, status: "DONE" });
  expect(harness.session!.reviewedCount).toBe(0);
  await page.reload();
  await expect(todo.getByRole("button", { name: "Reopen todo" })).toBeVisible();
});

test("Open record finds an older note beyond the first page", async ({page,harness}) => {
  const target = "80000000-0000-4000-8000-000000000008";
  let reads = 0;
  await page.route("**/api/v1/notes*", route => {
    reads++;
    const more = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({json:{data:more ? [{...harness.saved.notes[0],id:target,body:"Older addressed record"}] : harness.saved.notes,meta:more ? {} : {nextCursor:"synthetic-next"}}});
  });
  await page.goto(`/notes#record-${target}`);
  await expect(page.locator(`#record-${target}`)).toContainText("Older addressed record");
  expect(reads).toBe(2);
});
