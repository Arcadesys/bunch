import assert from "node:assert/strict";
import test from "node:test";
import { SystemError } from "./system-error";
import { requireAdminId } from "./admin-access";

test("admin access requires the authenticated owner to be the active operator", async () => {
  const calls: string[] = [];
  const ownerId = await requireAdminId(undefined, {
    requireOwnerId: async () => "auth0:google-oauth2|owner",
    assertOperator: async (candidate) => { calls.push(candidate); },
  });

  assert.equal(ownerId, "auth0:google-oauth2|owner");
  assert.deepEqual(calls, [ownerId]);
});

test("admin access preserves an operator denial", async () => {
  await assert.rejects(
    requireAdminId(undefined, {
      requireOwnerId: async () => "auth0:google-oauth2|friend",
      assertOperator: async () => {
        throw new SystemError("FORBIDDEN", "Operator access required.");
      },
    }),
    (error: unknown) => error instanceof SystemError && error.code === "FORBIDDEN",
  );
});

test("admin access normalizes the existing signed-out error", async () => {
  await assert.rejects(
    requireAdminId(undefined, {
      requireOwnerId: async () => {
        throw new Error("Sign in with Google to access private System records.");
      },
      assertOperator: async () => assert.fail("operator lookup must not run"),
    }),
    (error: unknown) => error instanceof SystemError && error.code === "UNAUTHORIZED",
  );
});
