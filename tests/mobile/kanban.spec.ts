import { test, expect } from "./fixtures";

test("board creates, moves, links, and keeps cancellation recoverable", async ({
  page,
  harness,
}, info) => {
  await page.goto("/board?view=board");
  await expect(page.getByRole("heading", { name: "To-do" })).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Kanban test task");
  await page.getByRole("button", { name: "Save todo", exact: true }).click();
  const task = page
    .getByRole("article")
    .filter({ hasText: "Kanban test task" });
  for (const [column, status] of [["Doing", "IN_PROGRESS"], ["Blocked", "BLOCKED"], ["Done", "DONE"], ["To-do", "OPEN"], ["Doing", "IN_PROGRESS"]]) {
    const destination = page.getByRole("heading", { name: column }).locator("..");
    if (info.project.name === "desktop") await task.dragTo(destination);
    else await task.getByLabel("Move to").selectOption(status);
    await expect(destination).toContainText("Kanban test task");
  }
  await expect(
    page.getByRole("heading", { name: "Doing" }).locator(".."),
  ).toContainText("Kanban test task");
  await task.getByLabel("Move to").selectOption("CANCELLED");
  await expect(
    page.getByRole("heading", { name: "Cancelled tasks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore to To-do" }).click();
  await expect.poll(
    () => harness.writes.some((write) => write.body.status === "OPEN"),
  ).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`board-${info.project.name}.png`), fullPage: true });
});

test("board retries a lost create response once and focuses the moved card", async ({ page, harness }, info) => {
  await page.goto("/board?view=board");
  harness.loseRecordResponse = true;
  await page.getByLabel("Title", { exact: true }).fill("Receipt retry task");
  await page.getByRole("button", { name: "Save todo", exact: true }).click();
  await expect(page.getByText("Failed to fetch", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Save todo", exact: true }).click();
  const task = page.getByRole("article").filter({ hasText: "Receipt retry task" });
  await expect(task).toHaveCount(1);
  expect(harness.saved.todos.filter((item) => item.title === "Receipt retry task")).toHaveLength(1);
  await task.getByRole("button", { name: "Mark todo complete", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(task).toBeFocused();
  await expect(page.getByRole("heading", { name: /^Done/ }).locator("..")).toContainText("Receipt retry task");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`board-${info.project.name}.png`), fullPage: true });
  if (info.project.name === "desktop") {
    await page.screenshot({ path: info.outputPath("board-preview.png"), fullPage: false });
  }
});

test("board edits, checks off, removes, deletes, and retains a failed checklist draft", async ({
  page,
  harness,
}) => {
  await page.goto("/board?view=board");
  const task = page.getByRole("article").filter({ hasText: "Fixture todo" });
  await task.getByRole("button", { name: "Edit task" }).click();
  await page.getByLabel("Task title").fill("Edited fixture todo");
  await page.getByRole("button", { name: "Save task details" }).click();
  await expect(
    page.getByRole("article").filter({ hasText: "Edited fixture todo" }),
  ).toBeVisible();
  const edited = page
    .getByRole("article")
    .filter({ hasText: "Edited fixture todo" });
  await edited.getByText("Owners", { exact: true }).click();
  await edited.getByLabel("Test Robin", { exact: true }).check();
  await edited.getByRole("button", { name: "Save owners" }).click();
  // The PATCH is asynchronous: wait for it rather than racing the click.
  await expect.poll(() => harness.writes.some((write) => Array.isArray(write.body.assigneeAlterIds) && write.body.assigneeAlterIds.includes(harness.profiles[0].id))).toBeTruthy();
  await edited.getByText(/^Checklist \(/).click();
  await edited.getByLabel(/New checklist item/).fill("First step");
  await edited.getByRole("button", { name: "Add checklist item" }).click();
  const item = edited.getByLabel("Checklist item First step");
  await item.locator("xpath=preceding-sibling::input").click();
  await expect(edited.getByText("Checklist (1/1)", { exact: true })).toBeVisible();
  await expect(edited.getByLabel("Move to")).toHaveValue("BLOCKED");
  await item.fill("Renamed step");
  await item.blur();
  await edited.getByRole("button", { name: "Remove" }).click();
  harness.writeStatus = 500;
  await edited.getByLabel(/New checklist item/).fill("Retry me");
  await edited.getByRole("button", { name: "Add checklist item" }).click();
  await expect(edited.getByLabel(/New checklist item/)).toHaveValue("Retry me");
  harness.writeStatus = 200;
  await edited.getByRole("button", { name: "Delete task" }).click();
  await edited.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(edited).toHaveCount(0);
});


test("linked journal edits appear on Board and task deletion preserves the note", async ({ page, harness }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/board?view=board");
  const task = page.getByRole("article").filter({ hasText: "Fixture todo" });
  await task.getByText("Linked notes (0)", { exact: true }).click();
  await task.getByLabel("Fixture note", { exact: true }).check();
  await task.getByRole("button", { name: "Save linked notes" }).click();
  await expect(task.locator("blockquote")).toHaveText("Fixture note");
  await page.goto("/notes");
  // Notes is a list/detail view: open the note, then edit it.
  await page.getByRole("button", { name: /^Fixture note/ }).click();
  await page.getByRole("button", { name: "Edit note", exact: true }).click();
  await page.getByLabel("Note", { exact: true }).fill("Updated independent journal");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Note updated.");
  await page.goto("/board?view=board");
  await expect(task.locator("blockquote")).toHaveText("Updated independent journal");
  await task.getByRole("button", { name: "Delete task", exact: true }).click();
  await task.getByRole("button", { name: "Confirm deletion", exact: true }).click();
  await expect(task).toHaveCount(0);
  await page.goto("/notes");
  await page.getByRole("button", { name: /^Updated independent journal/ }).click();
  await expect(page.getByRole("article")).toContainText("Updated independent journal");
  expect(harness.saved.notes[0].taskIds).toEqual([]);
  expect(errors).toEqual([]);
});

test("list view groups by status, shows detail, and changes status", async ({ page, harness }) => {
  harness.saved.todos.push({ ...harness.saved.todos[0], id: "40000000-0000-4000-8000-000000000003", title: "Second fixture todo", status: "IN_PROGRESS" });
  await page.goto("/board");
  const list = page.getByRole("region", { name: "Todos" });
  // Rows are grouped under status headers, in status order.
  await expect(list.locator(".ld-group")).toHaveText(["Blocked", "Doing"]);
  await expect(list.getByRole("button", { name: /Fixture todo/ }).first()).toContainText("Blocked");
  await list.getByRole("button", { name: /^Fixture todo/ }).click();
  const detail = page.getByRole("region", { name: "Todo details" });
  await expect(detail.getByRole("heading", { name: "Fixture todo", level: 2 })).toBeVisible();
  await expect(detail.getByRole("term").filter({ hasText: "Priority" })).toBeVisible();
  await expect(detail.getByRole("term").filter({ hasText: "Due date" })).toBeVisible();
  await expect(detail.getByRole("term").filter({ hasText: "Owners" })).toBeVisible();
  const status = detail.getByRole("group", { name: "Status" });
  await expect(status.getByRole("button", { name: "Blocked", exact: true })).toHaveAttribute("aria-pressed", "true");
  await status.getByRole("button", { name: "Doing", exact: true }).click();
  await expect(detail.getByRole("status")).toContainText("Fixture todo moved to Doing.");
  expect(harness.writes.at(-1)).toMatchObject({ method: "PATCH", path: `/api/v1/todos/${harness.saved.todos[0].id}`, body: { expectedVersion: 1, status: "IN_PROGRESS" } });
  await expect(status.getByRole("button", { name: "Doing", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Phones show one pane at a time; go back to the list to see the regrouped rows.
  const back = page.getByRole("button", { name: "← Todos" });
  if (await back.isVisible()) await back.click();
  await expect(list.locator(".ld-group")).toHaveText(["Doing"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
