import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { testPeople } from "./group-photo-setup";

// No route interception or provider substitute is permitted in this suite.
test("Home to a real privately saved and reopened finished group photo", async ({ page, request }, testInfo) => {
  await page.goto("/home");
  await page.getByRole("link", { name: "Group Photo", exact: true }).click();
  await page.getByLabel("Choose a JPEG, PNG, or WebP photo").setInputFiles("test-results/group-photo-fixtures/scene.png");
  await page.getByRole("button", { name: "Use this scene", exact: true }).click();
  const stage = page.getByLabel("Photo staging area", { exact: true });
  await expect(stage).toBeVisible();
  for (const [i, person] of testPeople.entries()) {
    await page.locator(".person-token").filter({ hasText: person.name }).click();
    const bounds = (await stage.boundingBox())!;
    await stage.click({ position: { x: bounds.width * (.15 + i * .13), y: bounds.height * .68 } });
    await expect(page.getByRole("status")).toContainText(`${person.name} placed`);
  }
  await page.getByRole("button", { name: "Send to Back", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Layer order saved");
  const projectId = new URL(page.url()).searchParams.get("project")!;
  const start = page.waitForResponse(response => response.url().endsWith(`/group-photos/${projectId}/renders`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Finish photo", exact: true }).click();
  const started = await start;
  expect(started.status()).toBe(202);
  const renderId = (await started.json()).data.id;
  await expect.poll(async () => {
    const response = await request.get(`/api/v1/group-photos/${projectId}`);
    const job = (await response.json()).data.renders.find((r: { id: string }) => r.id === renderId);
    if (job.state === "FAILED") throw new Error(job.errorMessage);
    return job.state;
  }, { timeout: 300_000, intervals: [2000, 4000] }).toBe("COMPLETE");
  const image = page.getByRole("img", { name: "Finished group photo", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(256);
  const pool = new Pool({ connectionString: process.env.GROUP_PHOTO_TEST_CONNECTION });
  try {
    const row = (await pool.query("select state,content_hash,storage_key,width,height from group_photo_render where id=$1", [renderId])).rows[0];
    expect(row.state).toBe("COMPLETE");
    const persisted = await readFile(`private-uploads/${row.storage_key}`);
    expect(createHash("sha256").update(persisted).digest("hex")).toBe(row.content_hash);
    await testInfo.attach("real-finished-photo", { body: persisted, contentType: "image/jpeg" });
    const delivered = await request.get(`/api/v1/group-photos/${projectId}/renders/${renderId}/image`);
    expect(delivered.ok()).toBeTruthy();
    expect(createHash("sha256").update(await delivered.body()).digest("hex")).toBe(row.content_hash);
    await testInfo.attach("generation-receipt", { body: JSON.stringify({ projectId, renderId, state: row.state, hash: row.content_hash, width: row.width, height: row.height }), contentType: "application/json" });
  } finally { await pool.end(); }
  // Ordinary navigation can reopen it; it is not just an in-memory preview.
  await page.getByRole("link", { name: "Start or reopen another scene" }).click();
  await page.locator(`a[href="/group-photo?project=${projectId}"]`).click();
  await expect(page.getByRole("img", { name: "Finished group photo", exact: true })).toBeVisible();
  await expect.poll(() => page.getByRole("img", { name: "Finished group photo", exact: true }).evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(256);
  await page.screenshot({ path: testInfo.outputPath("reopened-finished-photo.png"), fullPage: true });
});
