import { test, expect } from "./fixtures";

test("@eval read states do not present an unverified front or empty private records, and retry recovers", async ({ page, harness }) => {
  harness.readStatus = 500;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Catch-up could not be read" })).toBeVisible();
  await expect(page.getByText("Current front · confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Nothing in this view needs your eyes.", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No confirmed current front is recorded.", { exact: true })).toHaveCount(0);
  harness.readStatus = 200;
  await page.getByRole("button", { name: "Retry catch-up" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back, Test Robin" })).toBeVisible();
  await expect(page.getByText("Current front · confirmed", { exact: true })).toBeVisible();
  await expect(page.locator(".command-avatar")).toHaveText("TR");
});

test("@eval failed save keeps the entered draft and sends one write", async ({ page, harness }) => {
  harness.writeStatus = 409;
  await page.goto("/notes");
  const note = page.getByLabel("System-wide note", { exact: true });
  await note.fill("Keep this draft after a failed save");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Record changed");
  await expect(note).toHaveValue("Keep this draft after a failed save");
  expect(harness.writes).toHaveLength(1);
});

test("@eval changing an approved thread field withdraws its stale confirmation", async ({ page, harness }) => {
  await page.goto("/threads");
  await page.getByLabel("Thread link").fill("https://example.invalid/approved-thread");
  await page.getByLabel("Title", { exact: true }).fill("Synthetic thread");
  await page.getByLabel("Approved summary").fill("Approved summary only.");
  await page.getByLabel("Key decision or action").fill("Review the bounded change.");
  await page.getByRole("button", { name: "Save suggestion" }).click();
  await expect(page.getByRole("button", { name: "Confirm important thread" })).toBeVisible();
  await page.getByLabel("Approved summary").fill("Changed after save.");
  await expect(page.getByRole("button", { name: "Confirm important thread" })).toHaveCount(0);
  expect(harness.writes).toHaveLength(1);
});

test("@eval an authenticated empty catch-up still allows a System-wide note", async ({ page, harness }) => {
  harness.session = null;
  await page.goto("/notes");
  await expect(page.getByRole("heading", { name: "No catch-up is open" })).toBeVisible();
  await page.getByLabel("System-wide note", { exact: true }).fill("Synthetic note without a current front");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("System-wide note saved.");
  expect(harness.writes).toHaveLength(1);
});
