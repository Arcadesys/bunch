import assert from "node:assert/strict";
import test from "node:test";

test("generated-result upload route is disabled to keep Bunch independent from Furry Image Studio", async () => {
  const { POST } = await import("@/app/api/mcp-furry-result-upload/route");
  const response = await POST(new Request("http://localhost/api/mcp-furry-result-upload", { method: "POST" }));
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: "FURRY_IMAGE_STUDIO_DISABLED: Bunch does not integrate with Furry Image Studio." });
});
