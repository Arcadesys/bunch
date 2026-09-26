import { expect, test } from "./fixtures";
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlP+gAAAABJRU5ErkJggg==", "base64");
const photo = (id: string, kind = "scene") => ({ id, kind, createdAt: "2026-09-13T12:00:00Z", description: `Synthetic ${kind} photo ${id}`, width: 1024, height: 1024, imageUrl: `/api/v1/native-scenes/renders/${id}/image`, sourceUrl: `/images?render=${id}` });

test("gallery shows photo tiles, preserves them on older-page failure, retries and reloads", async ({ page }, testInfo) => {
  let failOlder = true;
  await page.route("**/api/v1/generated-images**", route => {
    const older = new URL(route.request().url()).searchParams.has("cursor");
    if (older && failOlder) return route.fulfill({ status: 503, json: { error: {} } });
    return route.fulfill({ json: { data: older ? [photo("older", "group")] : [photo("latest")], meta: { nextCursor: older ? null : "next" } } });
  });
  await page.route("**/api/v1/native-scenes/renders/*/image", route => route.fulfill({ contentType: "image/png", body: pixel }));
  await page.goto("/gallery/generated");
  await expect(page.getByRole("link", { name: "Gallery", exact: true })).toHaveAttribute("aria-current", "page");
  const tile = page.getByRole("button", { name: /Synthetic scene photo latest/ });
  await expect(tile).toBeVisible();
  const preview = tile.locator("img");
  await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  // One control per tile: the tile itself. Actions live in the viewer.
  await expect(page.getByRole("link", { name: "Download" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show older photos" }).click();
  await expect(page.getByRole("region", { name: "Saved photos" }).getByRole("alert")).toContainText("Could not load");
  await expect(tile).toBeVisible();
  failOlder = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /^Group photo/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show older photos" })).toHaveCount(0);
  await page.screenshot({ path: `test-results/generated-gallery-${testInfo.project.name}.png`, fullPage: true });
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(size.scroll).toBeLessThanOrEqual(size.client + 1);
  await page.reload();
  await expect(tile).toBeVisible();
});

test("the viewer shows the full photo with its actions and moves between photos", async ({ page }) => {
  const long = "Lucy and Tally sharing fries on the Navy Pier boardwalk at golden hour, film grain, warm light";
  await page.route("**/api/v1/generated-images**", route => route.fulfill({ json: { data: [{ ...photo("first"), description: long }, photo("second", "group")], meta: { nextCursor: null } } }));
  await page.route("**/api/v1/native-scenes/renders/*/image", route => route.fulfill({ contentType: "image/png", body: pixel }));
  await page.goto("/gallery/generated");
  const tile = page.getByRole("button", { name: /Lucy and Tally sharing fries on the Navy Pier boardwalk…/ });
  await tile.click();
  const viewer = page.getByRole("dialog", { name: "Lucy and Tally sharing fries on the Navy Pier boardwalk…" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("Photo 1 of 2")).toBeVisible();
  await expect(viewer.getByRole("img", { name: long })).toBeVisible();
  await expect(viewer.getByText(long, { exact: true })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/v1/native-scenes/renders/first/image");
  await expect(viewer.getByRole("link", { name: "Reopen scene" })).toHaveAttribute("href", "/images?render=first");
  await expect(viewer.getByRole("button", { name: "Previous photo" })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Group photo" })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Photo 2 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Previous photo" }).click();
  await expect(viewer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(tile).toBeFocused();
});

test("gallery distinguishes an empty gallery from sign-in failure", async ({ page }) => {
  let signedIn = false;
  await page.route("**/api/v1/generated-images**", route => signedIn ? route.fulfill({ json: { data: [], meta: { nextCursor: null } } }) : route.fulfill({ status: 401, json: {} }));
  await page.goto("/gallery/generated");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("No photos yet")).toHaveCount(0);
  signedIn = true;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "No photos yet" })).toBeVisible();
});

test("gallery deletes a photo only after confirmation and explains a refusal", async ({ page }) => {
  const deletes: string[] = [];
  let refuse = true;
  await page.route("**/api/v1/generated-images**", route => route.fulfill({ json: { data: [photo("keep"), photo("gone", "group")], meta: { nextCursor: null } } }));
  await page.route("**/api/v1/native-scenes/renders/*/image", route => route.fulfill({ contentType: "image/png", body: pixel }));
  await page.route("**/api/v1/account/generated-images/**", route => {
    deletes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`);
    if (refuse) { refuse = false; return route.fulfill({ status: 409, json: { error: { code: "CONFLICT", message: "This image is still being made. Wait for it to finish, then delete it." } } }); }
    return route.fulfill({ json: { deleted: true } });
  });
  await page.goto("/gallery/generated");
  await page.getByRole("button", { name: /^Group photo/ }).click();
  const viewer = page.getByRole("dialog", { name: "Group photo" });
  const gone = viewer.getByRole("button", { name: "Delete group photo: Group photo" });
  await gone.click();
  const confirm = viewer.getByRole("group", { name: "Confirm deleting group photo: Group photo" });
  await expect(confirm.getByRole("button", { name: "Keep it" })).toBeFocused();
  await confirm.getByRole("button", { name: "Keep it" }).click();
  expect(deletes).toEqual([]);
  await gone.click();
  await confirm.getByRole("button", { name: "Yes, delete permanently" }).click();
  await expect(confirm.getByRole("alert")).toHaveText("This image is still being made. Wait for it to finish, then delete it.");
  await confirm.getByRole("button", { name: "Yes, delete permanently" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Group photo/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Synthetic scene photo keep/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your photos, newest first" })).toBeFocused();
  await expect(page.getByRole("region", { name: "Saved photos" }).getByRole("status")).toContainText("The image was permanently deleted. 1 photo.");
  expect(deletes).toEqual(["DELETE /api/v1/account/generated-images/gone?kind=group", "DELETE /api/v1/account/generated-images/gone?kind=group"]);
});
