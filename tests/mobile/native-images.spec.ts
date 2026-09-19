import { expect, test } from "./fixtures";

type RenderState = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";

const queuedRenderId = "a0000000-0000-4000-8000-000000000001";
const deepLinkRenderId = "a0000000-0000-4000-8000-000000000099";
const imageFixture = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlP+gAAAABJRU5ErkJggg==",
  "base64",
);

function render(
  id: string,
  state: RenderState,
  scene = "A quiet synthetic studio scene",
) {
  return {
    id,
    scene,
    alterNames: [],
    state,
    createdAt: "2026-09-13T12:00:00.000Z",
    finishedAt: state === "COMPLETE" ? "2026-09-13T12:01:00.000Z" : null,
    errorMessage: null,
    width: state === "COMPLETE" ? 1024 : null,
    height: state === "COMPLETE" ? 1024 : null,
  };
}

test("a prompt-only mock render queues, completes, decodes, and reloads", async ({
  page,
}) => {
  let complete = false;
  let posted: Record<string, unknown> | undefined;
  const recent = Array.from({ length: 20 }, (_, index) =>
    render(
      `b0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      "COMPLETE",
      `Recent synthetic render ${index + 1}`,
    ),
  );

  await page.route("**/api/v1/alters**", (route) =>
    route.fulfill({ json: { data: [], meta: {} } }),
  );
  await page.route("**/api/v1/native-scenes/renders", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      posted = body;
      return route.fulfill({
        json: { data: render(queuedRenderId, "QUEUED", body.scene as string) },
      });
    }
    return route.fulfill({
      json: {
        data: complete ? [render(queuedRenderId, "COMPLETE"), ...recent] : [],
        meta: { available: true },
      },
    });
  });
  await page.route("**/api/v1/native-scenes/renders/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/image")) {
      // Mock fixture only: this proves a decoded browser image and neutral UI
      // description, never generation quality, identity, or private storage.
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: imageFixture,
      });
    }
    return route.fulfill({
      json: {
        data: render(
          deepLinkRenderId,
          "COMPLETE",
          "Deep-linked synthetic render",
        ),
      },
    });
  });

  await page.goto("/images");
  await expect(
    page.getByText("No private images generated here yet."),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Describe the image" })
    .fill("A quiet synthetic studio scene");
  await page.getByRole("button", { name: "Generate private image" }).click();

  await expect(
    page.getByRole("heading", { name: "Private image in progress" }),
  ).toBeVisible();
  expect(posted).toEqual({
    scene: "A quiet synthetic studio scene",
    alterNames: [],
    format: "square",
  });

  complete = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Private image ready" }).first(),
  ).toBeVisible();
  const image = page
    .getByRole("img", { name: "Generated private image" })
    .first();
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "Generated private image");
  expect(
    await image.evaluate((element: HTMLImageElement) => ({
      complete: element.complete,
      width: element.naturalWidth,
    })),
  ).toEqual({ complete: true, width: 1 });

  // The requested id is deliberately absent from the 20-item history page.
  await page.goto(`/images?render=${deepLinkRenderId}`);
  await expect(page.getByText("Deep-linked synthetic render")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Generated private image" }).first(),
  ).toBeVisible();
});

test("optional people use every paginated exact name without horizontal overflow", async ({
  page,
}, testInfo) => {
  const alterRequests: string[] = [];
  let posted: Record<string, unknown> | undefined;
  const firstPerson = {
    id: "c0000000-0000-4000-8000-000000000001",
    name: "Avery Fixture",
    appearanceReferenceImageIds: ["reference-a"],
    images: [{ id: "reference-a", isProfilePicture: false }],
  };
  const secondPerson = {
    id: "c0000000-0000-4000-8000-000000000002",
    name: "Blake Fixture",
    appearanceReferenceImageIds: ["reference-b", "reference-c"],
    images: [
      { id: "reference-b", isProfilePicture: true },
      { id: "reference-c", isProfilePicture: false },
      { id: "album-only", isProfilePicture: false },
    ],
  };

  await page.route("**/api/v1/alters**", (route) => {
    const url = new URL(route.request().url());
    alterRequests.push(url.search);
    return route.fulfill({
      json:
        url.searchParams.get("cursor") === "second-page"
          ? { data: [secondPerson], meta: {} }
          : { data: [firstPerson], meta: { nextCursor: "second-page" } },
    });
  });
  await page.route("**/api/v1/native-scenes/renders", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      posted = body;
      return route.fulfill({
        json: {
          data: {
            ...render(queuedRenderId, "QUEUED", body.scene as string),
            alterNames: body.alterNames,
          },
        },
      });
    }
    return route.fulfill({ json: { data: [], meta: { available: true } } });
  });
  await page.route("**/api/v1/images/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: imageFixture,
    }),
  );

  await page.goto("/images");
  await expect(page.getByLabel(/Avery Fixture/)).toBeVisible();
  await expect(page.getByLabel(/Blake Fixture/)).toBeVisible();
  await expect(page.getByText("Blake Fixture private album (3 pictures)"))
    .toBeVisible();
  await page.getByText("Blake Fixture private album (3 pictures)").click();
  await expect(
    page.getByRole("img", { name: "Private picture 1 for Blake Fixture" }),
  ).toBeVisible();
  expect(alterRequests).toEqual(
    expect.arrayContaining(["?limit=100", "?limit=100&cursor=second-page"]),
  );

  await page.getByLabel(/Blake Fixture/).check();
  await page.getByLabel(/Avery Fixture/).check();
  await page
    .getByRole("textbox", { name: "Describe the image" })
    .fill("Two fixture people in a mock scene");
  await page.getByLabel("Format").selectOption("landscape");
  await page.getByRole("button", { name: "Generate private image" }).click();
  expect(posted).toEqual({
    scene: "Two fixture people in a mock scene",
    alterNames: ["Blake Fixture", "Avery Fixture"],
    format: "landscape",
  });

  if (testInfo.project.name === "phone-320") {
    const reflow = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(
      reflow.scroll,
      "The 320px people picker and queued status must fit the viewport",
    ).toBeLessThanOrEqual(reflow.client + 1);
  }
});

test("repair preserves the original, shows allowance, and reopens both images", async ({ page }, testInfo) => {
  const original = render(deepLinkRenderId, "COMPLETE", "Original synthetic scene");
  const repaired = render(queuedRenderId, "COMPLETE", "Make the background blue");
  let submitted = false;
  let body: Record<string, unknown> | undefined;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const allowance = () => ({ limit: 10, used: submitted ? 2 : 1, reserved: 0, remaining: submitted ? 8 : 9, resetsAt: "2026-09-20T05:00:00Z" });
  await page.route("**/api/v1/alters**", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/image-repair-sources", route => route.fulfill({ json: { data: [{ kind: "native", id: original.id, label: original.scene, url: `/api/v1/native-scenes/renders/${original.id}/image` }] } }));
  await page.route("**/api/v1/native-scenes/renders", async route => {
    if (route.request().method() === "POST") { body = route.request().postDataJSON(); submitted = true; return route.fulfill({ json: { data: repaired, meta: { allowance: allowance() } } }); }
    return route.fulfill({ json: { data: submitted ? [repaired, original] : [original], meta: { available: true, allowance: allowance() } } });
  });
  await page.route("**/api/v1/native-scenes/renders/*/image", route => route.fulfill({ contentType: "image/png", body: imageFixture }));
  await page.goto("/images");
  await expect(page.getByRole("heading", { name: "Images", exact: true })).toBeVisible();
  await expect(page.getByText("9 of 10 image uses remaining")).toBeVisible();
  await page.getByRole("button", { name: "Repair this image", exact: true }).click();
  const correction = page.getByRole("textbox", { name: "Describe the correction" });
  await expect(correction).toBeFocused();
  await expect(page.getByRole("img", { name: "Original image selected for repair" })).toBeVisible();
  await correction.fill("Make the background blue");
  const submit = page.getByRole("button", { name: "Repair and save new image" });
  await submit.focus();
  await expect(submit).toBeFocused();
  const size = await submit.boundingBox();
  expect(size?.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Repair started. Your original is preserved; the new image will appear in history.")).toBeVisible();
  expect(body).toEqual({ scene: "Make the background blue", repairSource: { kind: "native", id: original.id } });
  await page.reload();
  await expect(page.getByText("8 of 10 image uses remaining")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Private image ready" })).toHaveCount(2);
  const images = page.getByRole("img", { name: "Generated private image" });
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("repair-allowance.png"), fullPage: true });
});

test("exhausted allowance disables generation and explains reset", async ({ page }) => {
  await page.route("**/api/v1/alters**", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/native-scenes/renders", route => route.fulfill({ json: { data: [], meta: { available: true, allowance: { limit: 10, used: 10, reserved: 0, remaining: 0, resetsAt: "2026-09-20T05:00:00Z" } } } }));
  await page.goto("/images");
  await expect(page.getByText("0 of 10 image uses remaining")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate private image" })).toBeDisabled();
  await expect(page.getByText(/Resets .*your local time/)).toBeVisible();
});
