import assert from "node:assert/strict";
import test, { mock } from "node:test";
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

test("unexpected failures log their real cause but still return a generic body", async () => {
  const logged = mock.method(console, "error", () => {});
  try {
    const dbError = Object.assign(new Error("connection terminated unexpectedly"), { code: "57P01" });
    const response = await apiResponse(async () => { throw dbError; });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      error: { code: "INTERNAL_ERROR", message: "The server could not complete the request." },
    });
    assert.equal(logged.mock.calls.length, 1);
    const [message, details] = logged.mock.calls[0].arguments;
    assert.equal(message, "[api] request failed");
    assert.deepEqual(details, {
      code: "INTERNAL_ERROR",
      name: "Error",
      pgCode: "57P01",
      message: "connection terminated unexpectedly",
    });
  } finally {
    logged.mock.restore();
  }
});
