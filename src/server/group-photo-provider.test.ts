import assert from "node:assert/strict";
import test from "node:test";
import { openAIGroupPhotoProvider, photoFinisherAvailable } from "./group-photo-provider";

test("image edit transport includes only explicit image bytes and redacts provider failures", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal(photoFinisherAvailable(), false);
    process.env.OPENAI_API_KEY = "synthetic-provider-contract-test";
    const input = { prompt: "Three people together on the left", model: "gpt-image-2.5-sunburst", size: "1536x1024", images: [{ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", name: "scene.png" }] };
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      assert.ok(options?.signal);
      assert.equal(options?.method, "POST");
      const form = options?.body as FormData;
      assert.equal(form.get("prompt"), input.prompt);
      assert.equal(form.get("output_format"), "jpeg");
      assert.equal(form.getAll("image[]").length, 1);
      assert.deepEqual(new Uint8Array(await (form.get("image[]") as File).arrayBuffer()), input.images[0].bytes);
      return Response.json({ data: [{ b64_json: "AQID" }] });
    };
    assert.deepEqual(await openAIGroupPhotoProvider(input), new Uint8Array([1, 2, 3]));
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response("PRIVATE_PROVIDER_ERROR_WITH_SECRET", { status: 401 });
    await assert.rejects(openAIGroupPhotoProvider(input), error => error instanceof Error && !error.message.includes("SECRET") && error.message.includes("provider could not"));
  } finally { globalThis.fetch = originalFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
});
