import assert from "node:assert/strict";
import test from "node:test";

test("generated-result upload route is disabled to keep Bunch independent from Furry Image Studio", async () => {
  const { POST } = await import("@/app/api/mcp-furry-result-upload/route");
  const expected = { error: "FURRY_IMAGE_STUDIO_DISABLED: Bunch does not integrate with Furry Image Studio." };

  const empty = await POST(new Request("http://localhost/api/mcp-furry-result-upload", { method: "POST" }));
  assert.equal(empty.status, 410);
  assert.deepEqual(await empty.json(), expected);

  const form = new FormData();
  form.append("alterId", "11111111-1111-4111-8111-111111111111");
  form.append("image", new File([Uint8Array.from([1, 2, 3])], "keeper.png", { type: "image/png" }));
  const legacy = await POST(new Request("http://localhost/api/mcp-furry-result-upload", { method: "POST", headers: { authorization: "******" }, body: form }));
  assert.equal(legacy.status, 410);
  assert.deepEqual(await legacy.json(), expected);
});
