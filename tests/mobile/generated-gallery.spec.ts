import { expect, test } from "./fixtures";
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlP+gAAAABJRU5ErkJggg==", "base64");
const photo = (id: string, kind = "scene") => ({ id, kind, createdAt: "2026-09-13T12:00:00Z", description: `Synthetic ${kind} photo ${id}`, width: 1024, height: 1024, imageUrl: `/api/v1/native-scenes/renders/${id}/image`, sourceUrl: `/images?render=${id}` });

test("gallery shows saved previews, preserves them on older-page failure, retries and reloads", async ({ page }, testInfo) => {
  let failOlder = true;
  await page.route("**/api/v1/generated-images**", route => {
    const older = new URL(route.request().url()).searchParams.has("cursor");
    if (older && failOlder) return route.fulfill({ status: 503, json: { error: {} } });
    return route.fulfill({ json: { data: older ? [photo("older", "group")] : [photo("latest")], meta: { nextCursor: older ? null : "next" } } });
  });
  await page.route("**/api/v1/native-scenes/renders/*/image", route => route.fulfill({ contentType: "image/png", body: pixel }));
  await page.goto("/gallery/generated");
  await expect(page.getByRole("link", { name: "Gallery", exact: true })).toHaveAttribute("aria-current", "page");
  const preview = page.getByRole("img", { name: "Synthetic scene photo latest" });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await page.getByRole("button", { name: "Load older photos" }).click();
  await expect(page.getByRole("region", { name: "Saved photos" }).getByRole("alert")).toContainText("Could not load");
  await expect(preview).toBeVisible();
  failOlder = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic group photo older" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load older photos" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View full image", exact: true }).first()).toHaveAttribute("href", "/api/v1/native-scenes/renders/latest/image");
  await expect(page.getByRole("link", { name: "Reopen scene" }).first()).toHaveAttribute("href", "/images?render=latest");
  await page.screenshot({ path: `test-results/generated-gallery-${testInfo.project.name}.png`, fullPage: true });
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  await page.reload();
  await expect(preview).toBeVisible();
});

test("gallery distinguishes an empty gallery from sign-in failure", async ({ page }) => {
  let signedIn = false;
  await page.route("**/api/v1/generated-images**", route => signedIn ? route.fulfill({ json: { data: [], meta: { nextCursor: null } } }) : route.fulfill({ status: 401, json: {} }));
  await page.goto("/gallery/generated");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("No generated photos yet")).toHaveCount(0);
  signedIn = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "No generated photos yet" })).toBeVisible();
});
