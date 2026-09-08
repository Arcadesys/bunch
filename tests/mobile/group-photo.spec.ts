import { test, expect } from "./fixtures";

const project = {
  id: "70000000-0000-4000-8000-000000000001", backplateContentType: "image/png", status: "READY", version: 1,
  createdAt: "2026-09-08T12:00:00.000Z", updatedAt: "2026-09-08T12:00:00.000Z", placements: [],
  sceneAnalysis: { source: "PROVISIONAL", camera: { height: "eye-level", angle: "level" }, lighting: { direction: "unknown", colorTemperature: "unknown" }, recommendations: [], occupancyZones: [
    { id: "front-row", type: "sit", label: "Front row", bounds: { x: 10, y: 62, width: 80, height: 27 }, capacity: 4, depth: 36 },
    { id: "back-row", type: "stand", label: "Back row", bounds: { x: 12, y: 24, width: 76, height: 38 }, capacity: 5, depth: 68 },
  ] },
};

test("Group Photo saves an accessible approximate placement after a backplate upload", async ({ page }) => {
  const robin = "20000000-0000-4000-8000-000000000001";
  let savedBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/alters", route => route.fulfill({ json: { data: [{ id: robin, name: "Test Robin", profilePicture: { id: "portrait-1" }, images: [{ id: "portrait-1", isProfilePicture: true }] }], meta: {} } }));
  await page.route("**/api/v1/group-photos", route => route.fulfill({ status: 201, json: { data: project, meta: {} } }));
  await page.route(`**/api/v1/group-photos/${project.id}/backplate`, route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#193049"/></svg>' }));
  await page.route(`**/api/v1/group-photos/${project.id}/placements`, route => {
    savedBody = route.request().postDataJSON();
    return route.fulfill({ json: { data: { ...project, version: 2, placements: [{ id: "80000000-0000-4000-8000-000000000001", ...savedBody, version: 1, createdAt: project.createdAt, updatedAt: project.updatedAt }] }, meta: {} } });
  });
  await page.goto("/group-photo");
  await page.getByLabel("Choose a JPEG, PNG, or WebP photo").setInputFiles({ name: "room.png", mimeType: "image/png", buffer: Buffer.from("fake-image") });
  await page.getByRole("button", { name: "Analyze photo" }).click();
  await expect(page.getByText("Place people on the photo")).toBeVisible();
  await page.getByRole("button", { name: /Test Robin/ }).click();
  await page.getByRole("button", { name: "Front center" }).click();
  await expect(page.getByText("Test Robin is staged in Front row.")).toBeVisible();
  expect(savedBody).toMatchObject({ alterId: robin, tokenX: 50, tokenY: 76, occupancyZoneId: "front-row", expectedVersion: 1 });
});
