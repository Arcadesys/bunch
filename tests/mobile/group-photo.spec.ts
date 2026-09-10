import { test, expect } from "./fixtures";
import { arrangePlacements, provisionalSceneAnalysis, type GroupPhotoProject } from "../../src/domain/group-photo";

// These are interaction tests only; they never claim image-generation acceptance.
test("direct placement keeps three people together and supports Arrange and keyboard movement", async ({ page }, testInfo) => {
  const people = ["Robin", "Finch", "Wren"].map((name, i) => ({ id: `20000000-0000-4000-8000-00000000000${i + 1}`, name: `Test ${name}` }));
  let project: GroupPhotoProject = { id: "70000000-0000-4000-8000-000000000001", backplateContentType: "image/png", status: "READY", version: 1, createdAt: "2026-09-09", updatedAt: "2026-09-09", placements: [], sceneAnalysis: provisionalSceneAnalysis() };
  let rejectMove = false;
  await page.route("**/api/v1/alters", route => route.fulfill({ json: { data: people, meta: {} } }));
  await page.route("**/api/v1/group-photos", route => route.fulfill({ status: 201, json: { data: project, meta: {} } }));
  await page.route(`**/api/v1/group-photos/${project.id}`, route => route.fulfill({ json: { data: project, meta: {} } }));
  await page.route(`**/api/v1/group-photos/${project.id}/backplate`, route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#193049"/></svg>' }));
  await page.route(`**/api/v1/group-photos/${project.id}/placements`, route => {
    const body = route.request().postDataJSON();
    if (rejectMove) return route.fulfill({ status: 409, json: { error: { message: "This Group Photo changed. Reload it, then try again." } } });
    expect(body.expectedVersion).toBe(project.version);
    const old = project.placements.find(p => p.alterId === body.alterId);
    project = { ...project, version: project.version + 1, placements: [...project.placements.filter(p => p.alterId !== body.alterId), { ...body, id: old?.id ?? body.alterId, version: 1, createdAt: project.createdAt, updatedAt: project.updatedAt }] };
    return route.fulfill({ json: { data: project, meta: {} } });
  });
  await page.route(`**/api/v1/group-photos/${project.id}/arrange`, route => {
    const body = route.request().postDataJSON();
    expect(body.expectedVersion).toBe(project.version);
    project = { ...project, version: project.version + 1, placements: arrangePlacements(project.placements, body.alterId, body.action) };
    return route.fulfill({ json: { data: project, meta: {} } });
  });
  await page.goto("/group-photo");
  await page.getByLabel("Choose a JPEG, PNG, or WebP photo").setInputFiles({ name: "room.png", mimeType: "image/png", buffer: Buffer.from("fixture") });
  await page.getByRole("button", { name: "Use this scene" }).click();
  const stage = page.getByLabel("Photo staging area", { exact: true });
  await expect(stage).toBeVisible();
  for (const [index, person] of people.entries()) {
    await page.getByRole("button", { name: new RegExp(person.name) }).click();
    const bounds = await stage.boundingBox();
    await stage.click({ position: { x: bounds!.width * .2, y: bounds!.height * (.25 + index * .3) } });
    await expect(page.getByRole("status")).toContainText(`${person.name} placed`);
  }
  expect(project.placements.every(p => p.tokenX <= 22)).toBeTruthy();
  const layerOrder = page.getByRole("list", { name: "Layer order, back to front" });
  for (const [label, names] of [
    ["Send to Back", ["Test Wren", "Test Robin", "Test Finch"]],
    ["Bring Forward", ["Test Robin", "Test Wren", "Test Finch"]],
    ["Bring to Front", ["Test Robin", "Test Finch", "Test Wren"]],
    ["Send Backward", ["Test Robin", "Test Wren", "Test Finch"]],
  ] as const) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(layerOrder.locator("li")).toHaveText([...names]);
  }
  const depth = project.placements.find(p => p.alterId === people[2].id)!.depth;
  await page.getByRole("button", { name: "Move Test Wren", exact: true }).press("ArrowRight");
  await expect(page.getByRole("status")).toContainText("Test Wren placed");
  expect(project.placements.find(p => p.alterId === people[2].id)!.depth).toBe(depth);
  const token = page.getByRole("button", { name: "Move Test Wren", exact: true });
  await token.scrollIntoViewIfNeeded();
  const tokenBounds = await token.boundingBox();
  const stageBounds = await stage.boundingBox();
  await page.mouse.move(tokenBounds!.x + tokenBounds!.width / 2, tokenBounds!.y + tokenBounds!.height / 2);
  await page.mouse.down();
  await page.mouse.move(stageBounds!.x + stageBounds!.width * .35, stageBounds!.y + stageBounds!.height * .7, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole("status")).toContainText("Test Wren placed at 35%");
  expect(project.placements.find(p => p.alterId === people[2].id)!.depth).toBe(depth);
  const beforeFailure = project.placements.find(p => p.alterId === people[2].id)!.tokenX;
  rejectMove = true;
  await page.getByRole("button", { name: "Move right", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("This Group Photo changed");
  expect(project.placements.find(p => p.alterId === people[2].id)!.tokenX).toBe(beforeFailure);
  await expect(token).toHaveAttribute("style", /left: 35%/);
  await expect(page.locator(".occupancy-zone")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  rejectMove = false;
  await page.reload();
  await expect(page.getByRole("status")).toHaveText("Saved scene reopened.");
  // The People tray keeps occluded tokens selectable without changing their layer order.
  await page.locator(".person-token").filter({ hasText: "Test Wren" }).click();
  await expect(page.getByRole("list", { name: "Layer order, back to front" }).locator("li")).toHaveText(["Test Robin", "Test Wren", "Test Finch"]);
  await page.screenshot({ path: testInfo.outputPath("direct-placement.png"), fullPage: true });
});
