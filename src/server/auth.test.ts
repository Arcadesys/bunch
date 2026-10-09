import assert from "node:assert/strict";
import test from "node:test";
import { requireOwnerId, requirePilotIdentity } from "./auth";
import { SystemError } from "./system-error";

const authKeys = ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"] as const;

async function withoutAuth0(run: () => Promise<void>) {
  const saved = new Map(authKeys.map((key) => [key, process.env[key]]));
  const demo = process.env.SYSTEM_DEMO_MODE;
  try {
    for (const key of authKeys) delete process.env[key];
    process.env.SYSTEM_DEMO_MODE = "false";
    await run();
  } finally {
    for (const key of authKeys) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (demo === undefined) delete process.env.SYSTEM_DEMO_MODE;
    else process.env.SYSTEM_DEMO_MODE = demo;
  }
}

test("private identities report authentication unavailable when Auth0 is not configured", async () => {
  await withoutAuth0(async () => {
    for (const read of [() => requireOwnerId(), () => requirePilotIdentity()]) {
      await assert.rejects(read, (error: unknown) => error instanceof SystemError && error.code === "AUTH_UNAVAILABLE");
    }
  });
});
