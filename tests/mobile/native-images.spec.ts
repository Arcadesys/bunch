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
