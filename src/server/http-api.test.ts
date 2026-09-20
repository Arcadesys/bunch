import assert from "node:assert/strict";
import test from "node:test";
import { apiResponse } from "./http-api";
import { SystemError } from "./system-error";

test("owner-scoped API responses default to private no-store", async () => {
  const response = await apiResponse(async () => Response.json({ data: [] }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("authentication failures retain structured status and private no-store", async () => {
  for (const [code, status] of [["UNAUTHORIZED", 401], ["AUTH_UNAVAILABLE", 503]] as const) {
    const response = await apiResponse(async () => {
      throw new SystemError(code, code === "UNAUTHORIZED" ? "Sign in." : "Sign-in is unavailable.");
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      error: {
        code,
        message: code === "UNAUTHORIZED" ? "Sign in." : "Sign-in is unavailable.",
      },
    });
  }
});
