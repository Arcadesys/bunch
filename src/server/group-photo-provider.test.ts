import assert from "node:assert/strict";
import test from "node:test";
import { GroupPhotoProviderError, openAIGroupPhotoProvider, openAINativeSceneProvider, photoFinisherAvailable } from "./group-photo-provider";

test("image edit transport includes only explicit image bytes and redacts provider failures", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal(photoFinisherAvailable(), false);
    process.env.OPENAI_API_KEY = "synthetic-provider-contract-test";
    const input = { prompt: "Three people together on the left", model: "gpt-image-2.5-sunburst", quality: "high" as const, size: "1536x1024", images: [{ bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", name: "scene.png" }] };
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/images/edits");
      assert.ok(options?.signal);
      assert.equal(options?.method, "POST");
      const form = options?.body as FormData;
      assert.equal(form.get("prompt"), input.prompt);
      assert.equal(form.get("output_format"), "jpeg");
      assert.equal(form.get("quality"), "high");
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

test("native scenes use generations without references and edits with every reference", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-provider-contract-test";
  try {
    const calls: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return Response.json({ data: [{ b64_json: "AQID" }] }); };
    await openAINativeSceneProvider({ prompt: "A quiet room", model: "test", quality: "medium", size: "1024x1024", references: [] });
    await openAINativeSceneProvider({ prompt: "Two people", model: "test", quality: "low", size: "1024x1024", references: [{ bytes: new Uint8Array([1]), contentType: "image/png", name: "first" }, { bytes: new Uint8Array([2]), contentType: "image/jpeg", name: "second" }] });
    assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
    assert.deepEqual(JSON.parse(String(calls[0].options?.body)), { model: "test", prompt: "A quiet room", size: "1024x1024", quality: "medium", output_format: "jpeg" });
    assert.equal(calls[1].url, "https://api.openai.com/v1/images/edits");
    assert.equal((calls[1].options?.body as FormData).getAll("image[]").length, 2);
    assert.equal((calls[1].options?.body as FormData).get("quality"), "low");
  } finally { globalThis.fetch = originalFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
});

test("classifies provider failures instead of collapsing them into one generic message", async () => {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-provider-contract-test";
  const input = { prompt: "p", model: "m", quality: "high" as const, size: "1024x1024", images: [] };
  try {
    globalThis.fetch = async () => new Response("rate limited", { status: 429 });
    await assert.rejects(openAIGroupPhotoProvider(input), (error: unknown) => error instanceof GroupPhotoProviderError && error.code === "RATE_LIMITED");
    globalThis.fetch = async () => new Response("bad request", { status: 400 });
    await assert.rejects(openAIGroupPhotoProvider(input), (error: unknown) => error instanceof GroupPhotoProviderError && error.code === "CONTENT_POLICY");
    globalThis.fetch = async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); };
    await assert.rejects(openAIGroupPhotoProvider(input), (error: unknown) => error instanceof GroupPhotoProviderError && error.code === "TIMEOUT");
    globalThis.fetch = async () => { throw new Error("network down"); };
    await assert.rejects(openAIGroupPhotoProvider(input), (error: unknown) => error instanceof GroupPhotoProviderError && error.code === "UPSTREAM_ERROR");
    globalThis.fetch = async () => Response.json({ data: [{ b64_json: "" }] });
    await assert.rejects(openAIGroupPhotoProvider(input), (error: unknown) => error instanceof GroupPhotoProviderError && error.code === "BAD_OUTPUT");
  } finally { globalThis.fetch = originalFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
});
