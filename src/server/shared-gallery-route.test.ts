import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "@/app/api/public/gallery/[token]/images/[imageId]/route";

test("invalid shared image requests are not cacheable", async () => {
  const response = await GET(
    new Request("https://system.example/api/public/gallery/share/images/not-a-uuid"),
    { params: Promise.resolve({ token: "invalid", imageId: "not-a-uuid" }) },
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
