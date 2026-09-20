import { test, expect } from "./fixtures";

test("main task choices are visible before catch-up details on a phone", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "What would help right now?" })).toBeVisible();
  const tasks = page.getByRole("navigation", { name: "Things you can do" });
  const resume = tasks.getByRole("link", { name: "Resume my day", exact: false });
  const rect = await resume.boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(740);
  await expect(tasks.getByRole("link", { name: "Leave a note", exact: false })).toBeVisible();
  await expect(tasks.getByRole("link", { name: "Manage todos", exact: false })).toBeVisible();
  expect(await tasks.getByRole("link").count()).toBe(5);
});

for (const enlarged of [false, true]) {
  test(`home → note → save feedback → saved note → home${enlarged ? " at 200% text" : ""}`, async ({ page, harness }) => {
    if (enlarged) await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "40px"; }));
    await page.goto("/home");
    await page.getByRole("navigation", { name: "Things you can do" }).getByRole("link", { name: "Leave a note", exact: false }).click();
    const form = page.locator("#create-record");
    await expect(form.getByRole("heading", { name: "Leave a note" })).toBeFocused();
    await page.getByLabel("Note", { exact: true }).fill("A note found from Home");
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    const feedback = form.getByRole("status");
    await expect(feedback).toContainText("Note saved");
    await expect(feedback).toBeInViewport();
    await form.getByRole("link", { name: "View saved notes" }).click();
    await expect(page.getByRole("article").filter({ hasText: "A note found from Home" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(harness.writes).toHaveLength(1);
    await page.getByRole("navigation", { name: "Bunch navigation" }).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Things you can do" })).toBeVisible();
  });
}

test("home → todos → add → complete → home", async ({ page, harness }) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Manage todos", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Todos", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Add a todo", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("A task found from Home");
  await page.getByRole("button", { name: "Save todo", exact: true }).click();
  await expect(page.locator(".form-feedback").getByRole("status")).toContainText("Todo saved");
  await page.getByRole("link", { name: "View saved todos" }).click();
  const todo = page.getByRole("article").filter({ hasText: "A task found from Home" });
  await todo.getByRole("button", { name: "Mark todo complete" }).click();
  await expect(todo.getByRole("button", { name: "Reopen todo" })).toBeVisible();
  expect(harness.writes).toHaveLength(2);
  await page.getByRole("link", { name: "Back to Home", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Things you can do" })).toBeVisible();
});

test("home tasks lead to catch-up and explicit hosting controls with a return path", async ({ page, harness }) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Resume my day", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Your catch-up", exact: true })).toBeInViewport();
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: /^Switch\./ }).click();
  await expect(page.getByRole("heading", { name: "Record a switch as" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "What would help right now?" })).toBeVisible();
  expect(harness.writes).toEqual([]);
});

test("home → save thread → confirm → home → people → home", async ({ page, harness }) => {
  await page.route("**/api/system", route => route.fulfill({ json: { profiles: [{ id: "test-robin", name: "Test Robin", version: 1, images: [], profilePicture: null }], currentFront: null, assignments: [] } }));
  await page.goto("/home");
  await page.getByText("More places", { exact: true }).click();
  await page.getByRole("navigation", { name: "More places" }).getByRole("link", { name: "Save a thread" }).click();
  await expect(page.getByRole("heading", { name: "Save a thread" })).toBeFocused();
  await page.getByLabel("Thread link").fill("https://example.invalid/demo");
  await page.getByLabel("Title", { exact: true }).fill("Demo thread");
  await page.getByLabel("Approved summary").fill("Synthetic summary");
  await page.getByLabel("Key decision or action").fill("Synthetic next step");
  await page.getByRole("button", { name: "Save suggestion" }).click();
  await expect(page.locator(".form-feedback")).toContainText("Confirm it only after");
  await page.getByRole("button", { name: "Confirm important thread" }).click();
  await expect(page.locator(".form-feedback").getByRole("status")).toContainText("Important thread confirmed");
  await page.getByRole("link", { name: "Back to Home", exact: true }).click();
  await page.getByRole("link", { name: "People & pictures" }).click();
  await expect(page.getByRole("heading", { name: "Test Robin", exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Bunch navigation" }).getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Things you can do" })).toBeVisible();
  expect(harness.writes).toHaveLength(2);
});
