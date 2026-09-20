import assert from "node:assert/strict";
import test from "node:test";
import { privateInlineImageHeaders } from "@/app/api/system/images/inline/[imageId]/route";

test("private inline image bytes are fetchable by the sandboxed handoff widget without becoming cacheable", () => {
  const headers = privateInlineImageHeaders("image/png", '"image-etag"');
  assert.equal(headers["Access-Control-Allow-Origin"], "*");
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "cross-origin");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Content-Type"], "image/png");
  assert.equal(headers.ETag, '"image-etag"');
});
