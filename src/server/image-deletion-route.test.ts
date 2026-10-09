import assert from "node:assert/strict";
import test from "node:test";
import { DELETE as deleteGenerated } from "@/app/api/v1/account/generated-images/[imageId]/route";
import { DELETE as deleteUpload } from "@/app/api/v1/account/images/[imageId]/route";

const imageId = "00000000-0000-4000-8000-000000000001";

test("image deletion routes reject cross-origin requests before reading the account", async () => {
  for (const [handler, path] of [[deleteGenerated, "generated-images"], [deleteUpload, "images"]] as const) {
    const response = await handler(
      new Request(`https://bunch.example/api/v1/account/${path}/${imageId}?kind=scene`, { method: "DELETE", headers: { origin: "https://evil.example" } }),
      { params: Promise.resolve({ imageId }) },
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
});
