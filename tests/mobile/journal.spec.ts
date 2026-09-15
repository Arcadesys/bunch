import { test, expect } from "./fixtures";

const stamp = "2026-09-04T12:00:00.000Z";
const linkedNoteId = "40000000-0000-4000-8000-000000000005";
const secondTodo = { id: "40000000-0000-4000-8000-000000000003", title: "Prepare the piano chart", status: "OPEN", priority: "NORMAL", assigneeAlterIds: [], checklist: [], noteIds: [], version: 1, updatedAt: stamp, createdAt: stamp };

test("Notes journal creates a note with several reciprocal Board task references", async ({ page, harness }, info) => {
  harness.saved.todos.push(secondTodo);
  await page.goto("/notes");
  await page.getByRole("link", { name: "Leave a note" }).click();
  await expect(page.getByRole("heading", { name: "Leave a note" })).toBeFocused();
  await page.getByLabel("Note", { exact: true }).fill("Bring the arrangement to rehearsal.");
  await page.getByRole("combobox", { name: "Recipient", exact: true }).selectOption(harness.profiles[1].id);
  await page.getByLabel("Fixture todo", { exact: true }).check();
  await page.getByLabel("Prepare the piano chart", { exact: true }).check();
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Note saved to Notes.");
  const note = page.getByRole("article").filter({ hasText: "Bring the arrangement to rehearsal." });
  await expect(note.getByRole("region", { name: "Linked tasks" })).toContainText("Fixture todo");
  await expect(note.getByRole("region", { name: "Linked tasks" })).toContainText("Prepare the piano chart");
  const savedNote = harness.saved.notes.find((item) => item.body === "Bring the arrangement to rehearsal.");
  expect(savedNote?.taskIds).toHaveLength(2);
  expect(harness.saved.todos.filter((todo) => todo.title === "Fixture todo" || todo.title === "Prepare the piano chart").every((todo) => (todo.noteIds as string[]).includes(savedNote!.id))).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`notes-${info.project.name}.png`), fullPage: true });
});

test("Notes journal preserves tasks while editing then deleting a linked note", async ({ page, harness }) => {
  harness.saved.todos[0].noteIds = [linkedNoteId];
  harness.saved.todos.push({ ...secondTodo, noteIds: [linkedNoteId] });
  harness.saved.notes[0] = { id: linkedNoteId, body: "Bring the arrangement to rehearsal.", giftImages: [], taskIds: [harness.saved.todos[0].id, secondTodo.id], version: 1, updatedAt: stamp, createdAt: stamp };
  await page.goto("/notes");
  const note = page.getByRole("article").filter({ hasText: "Bring the arrangement to rehearsal." });
  await note.getByRole("button", { name: "Edit note" }).click();
  await page.locator('textarea[name="body"]').fill("Bring the final arrangement to rehearsal.");
  await page.getByLabel("Fixture todo", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Note updated.");
  expect((harness.saved.notes.find((item) => item.id === linkedNoteId)?.taskIds as string[])).toEqual([secondTodo.id]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("article").filter({ hasText: "Bring the final arrangement to rehearsal." }).getByRole("button", { name: "Delete note" }).click();
  await expect(page.getByRole("status")).toContainText("1 task reference removed; tasks remain.");
  expect(harness.saved.notes.some((item) => item.id === linkedNoteId)).toBeFalsy();
  expect(harness.saved.todos.some((todo) => todo.title === "Prepare the piano chart")).toBeTruthy();
  expect(harness.saved.todos.find((todo) => todo.title === "Prepare the piano chart")?.noteIds).toEqual([]);
});

test("Notes journal keeps an edit draft after a version conflict", async ({ page, harness }) => {
  await page.goto("/notes");
  await page.getByRole("article").filter({ hasText: "Fixture note" }).getByRole("button", { name: "Edit note" }).click();
  const body = page.locator('textarea[name="body"]');
  await body.fill("Keep this note edit after a failed save");
  harness.writeStatus = 409;
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Record changed");
  await expect(body).toHaveValue("Keep this note edit after a failed save");
});
