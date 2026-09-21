import assert from "node:assert/strict";
import test from "node:test";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";

const lastModified = new Date("2026-09-21T12:34:56.000Z");
const media = { body: new Uint8Array([1, 2, 3]), contentType: "image/png", etag: '"private-image"', lastModified };

test("owner-private media is browser-private and carries validators", async () => {
  const response = privateMediaResponse(new Request("https://bunch.example/image"), media);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-cache, max-age=0, must-revalidate");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("etag"), '"private-image"');
  assert.equal(response.headers.get("last-modified"), lastModified.toUTCString());
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test("authenticated conditional requests return 304 without reading private bytes", async () => {
  const byEtag = privateMediaResponse(new Request("https://bunch.example/image", { headers: { "if-none-match": '"private-image"' } }), media);
  assert.equal(byEtag.status, 304);
  assert.equal(byEtag.headers.get("content-type"), null);
  assert.equal(await byEtag.text(), "");

  const byDate = privateMediaResponse(new Request("https://bunch.example/image", { headers: { "if-modified-since": lastModified.toUTCString() } }), media);
  assert.equal(byDate.status, 304);

  const mismatchedEtagWins = privateMediaResponse(new Request("https://bunch.example/image", { headers: {
    "if-none-match": '"different-image"',
    "if-modified-since": lastModified.toUTCString(),
  } }), media);
  assert.equal(mismatchedEtagWins.status, 200);
});

test("MCP capability media remains no-store and does not become conditional", async () => {
  const response = privateMediaResponse(new Request("https://bunch.example/image", { headers: { "if-none-match": '"private-image"' } }), media, { cache: "no-store", allowConditional: false });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
});

test("private media errors are explicitly no-store", () => {
  const response = privateMediaError("Not found", 404);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
});
