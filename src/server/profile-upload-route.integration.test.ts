import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return (server.address() as AddressInfo).port;
}

integration("profile upload receipt replays before storage reservation at the quota boundary", { timeout: 30_000 }, async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `profile_upload_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const schemaUrl = new URL(process.env.TEST_DATABASE_URL!);
  schemaUrl.searchParams.set("options", `-c search_path=${schema},public`);
  const previousEnv = { ...process.env };
  const schemaPool = new Pool({ connectionString: schemaUrl.toString() });
  const blobRequests: string[] = [];
  let putArrivals = 0;
  let putBarrierSize = 0;
  let releasePutBarrier: (() => void) | undefined;
  let putBarrier = new Promise<void>(() => undefined);
  const blobServer = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://blob.test").searchParams.get("pathname") ?? "";
    blobRequests.push(`${request.method} ${pathname}`);
    request.resume();
    request.on("end", async () => {
      if (request.method === "PUT" && putBarrierSize > 0) {
        putArrivals++;
        if (putArrivals === putBarrierSize) releasePutBarrier?.();
        await putBarrier;
      }
      response.setHeader("content-type", "application/json");
      if (request.method === "PUT") {
        response.end(JSON.stringify({
          url: `https://blob.test/${pathname}`,
          downloadUrl: `https://blob.test/${pathname}`,
          pathname,
          contentType: request.headers["content-type"] ?? "image/png",
          contentDisposition: "inline",
          etag: `etag-${blobRequests.length}`,
        }));
      } else response.end(JSON.stringify({}));
    });
  });

  process.env.DATABASE_URL = schemaUrl.toString();
  process.env.SYSTEM_E2E_TEST_MODE = "true";
  delete process.env.SYSTEM_DEMO_MODE;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_synthetic_fixture";
  process.env.VERCEL_BLOB_RETRIES = "0";
  try {
    await schemaPool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter((name) => name.endsWith(".sql")).sort()) {
      await schemaPool.query(await readFile(`drizzle/${file}`, "utf8"));
    }
    const subject = `auth0|upload-${randomUUID()}`;
    const { ownerIdFromAuth0Subject } = await import("@/server/auth");
    const ownerId = ownerIdFromAuth0Subject(subject);
    await schemaPool.query("insert into app_user(id,google_subject) values($1,$1)", [ownerId]);
    const quota = 8;
    await schemaPool.query("insert into pilot_account(owner_id,role,quota_bytes) values($1,'FRIEND',$2)", [ownerId, quota]);
    await schemaPool.query("update pilot_policy set gate_enabled=true,friends_enabled=true,uploads_enabled=true where id");
    const { SystemService } = await import("@/server/system-service");
    const system = new SystemService(schemaPool, async () => undefined);
    const profile = await system.createAlter(ownerId, { requestId: randomUUID(), name: "Upload fixture" }, "SYSTEM");
    const version = profile.data.version;
    const port = await listen(blobServer);
    process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${port}`;
    const { POST } = await import("@/app/api/system/images/route");

    async function sendToProfile(bytes: Uint8Array, requestId: string, alterId: string, expectedVersion: number, contentType = "image/png") {
      const form = new FormData();
      form.set("image", new File([bytes.slice().buffer as ArrayBuffer], "fixture.png", { type: contentType }));
      form.set("alterId", alterId);
      form.set("setAsProfilePicture", "true");
      form.set("expectedVersion", String(expectedVersion));
      form.set("requestId", requestId);
      return POST(new Request("https://bunch.example/api/system/images", {
        method: "POST",
        headers: { origin: "https://bunch.example", "x-system-e2e-subject": subject },
        body: form,
      }));
    }
    const send = (bytes: Uint8Array, requestId: string) => sendToProfile(bytes, requestId, profile.data.id, version);

    const requestId = randomUUID();
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const first = await send(bytes, requestId);
    assert.equal(first.status, 200, await first.clone().text());
    const firstBody = await first.json();
    assert.equal(firstBody.replayed, false);
    const reloaded = await new SystemService(schemaPool, async () => undefined).getAlter(ownerId, profile.data.id);
    assert.equal(reloaded.profilePicture?.id, firstBody.profile.profilePicture.id, "a fresh service read must show the saved profile picture");
    assert.equal(Number((await schemaPool.query("select count(*) from pilot_upload where owner_id=$1", [ownerId])).rows[0].count), 1);
    assert.equal(Number((await schemaPool.query("select count(*) from private_image where owner_id=$1 and alter_id=$2", [ownerId, profile.data.id])).rows[0].count), 1);
    assert.equal(blobRequests.filter((entry) => entry.startsWith("PUT ")).length, 1);

    const replay = await send(bytes, requestId);
    assert.equal(replay.status, 200, await replay.clone().text());
    assert.equal((await replay.json()).replayed, true);
    assert.equal(Number((await schemaPool.query("select count(*) from pilot_upload where owner_id=$1", [ownerId])).rows[0].count), 1, "replay must not reserve quota again");
    assert.equal(Number((await schemaPool.query("select count(*) from private_image where owner_id=$1 and alter_id=$2", [ownerId, profile.data.id])).rows[0].count), 1, "replay must not attach a duplicate image");
    assert.equal(blobRequests.filter((entry) => entry.startsWith("PUT ")).length, 1, "replay must not upload another Blob");

    const mismatch = await send(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 5]), requestId);
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).code, "CONFLICT");
    assert.equal(Number((await schemaPool.query("select count(*) from pilot_upload where owner_id=$1", [ownerId])).rows[0].count), 1);
    assert.equal(blobRequests.filter((entry) => entry.startsWith("PUT ")).length, 1, "mismatched content must be rejected before Blob storage");

    const changedVersion = await sendToProfile(bytes, requestId, profile.data.id, version + 1);
    assert.equal(changedVersion.status, 409);
    assert.equal((await changedVersion.json()).code, "CONFLICT");
    const changedType = await sendToProfile(bytes, requestId, profile.data.id, version, "image/jpeg");
    assert.equal(changedType.status, 409);
    assert.equal((await changedType.json()).code, "CONFLICT");
    assert.equal(blobRequests.filter((entry) => entry.startsWith("PUT ")).length, 1, "version/type mismatches must be rejected before Blob storage");

    const otherOwner = `auth0:other-${randomUUID()}`;
    await schemaPool.query("update pilot_policy set gate_enabled=false where id");
    await schemaPool.query("insert into app_user(id,google_subject) values($1,$1)", [otherOwner]);
    await schemaPool.query("insert into pilot_account(owner_id,role) values($1,'FRIEND')", [otherOwner]);
    await schemaPool.query("update pilot_policy set gate_enabled=true where id");
    const foreignProfile = await system.createAlter(otherOwner, { requestId: randomUUID(), name: "Foreign fixture" }, "SYSTEM");
    const foreignTarget = await sendToProfile(bytes, requestId, foreignProfile.data.id, version);
    assert.equal(foreignTarget.status, 404, "target authorization must run before any receipt disclosure");
    assert.equal(blobRequests.filter((entry) => entry.startsWith("PUT ")).length, 1);

    // Both concurrent requests pass the empty-receipt preflight before either storage
    // write completes. The transactional receipt lock must still attach only one image.
    await schemaPool.query("update pilot_account set quota_bytes=64 where owner_id=$1", [ownerId]);
    const concurrentProfile = await system.createAlter(ownerId, { requestId: randomUUID(), name: "Concurrent fixture" }, "SYSTEM");
    putBarrierSize = 2;
    putArrivals = 0;
    putBarrier = new Promise<void>((resolve) => { releasePutBarrier = resolve; });
    const concurrentId = randomUUID();
    const concurrentResponses = await Promise.all([
      sendToProfile(bytes, concurrentId, concurrentProfile.data.id, concurrentProfile.data.version),
      sendToProfile(bytes, concurrentId, concurrentProfile.data.id, concurrentProfile.data.version),
    ]);
    putBarrierSize = 0;
    assert.deepEqual(concurrentResponses.map((response) => response.status), [200, 200]);
    const replayStates = await Promise.all(concurrentResponses.map(async (response) => (await response.json()).replayed));
    assert.deepEqual(replayStates.sort(), [false, true]);
    assert.equal(Number((await schemaPool.query("select count(*) from private_image where owner_id=$1 and alter_id=$2", [ownerId, concurrentProfile.data.id])).rows[0].count), 1);
    assert.equal(Number((await schemaPool.query("select count(*) from pilot_upload where owner_id=$1", [ownerId])).rows[0].count), 2, "the duplicate concurrent blob reservation is released");

    await schemaPool.query("update pilot_account set state='REVOKED' where owner_id=$1", [ownerId]);
    const revokedReplay = await send(bytes, requestId);
    assert.equal(revokedReplay.status, 403);
    assert.equal((await revokedReplay.json()).code, "FORBIDDEN");
    assert.equal(Number((await schemaPool.query("select count(*) from pilot_upload where owner_id=$1", [ownerId])).rows[0].count), 2, "revoked retry cannot read the receipt or reserve storage");
    assert.equal(blobRequests.filter((entry) => entry.startsWith("PUT ")).length, 3, "revoked retry must not upload to Blob");

    await schemaPool.query("update pilot_account set state='ACTIVE' where owner_id=$1", [ownerId]);
    await schemaPool.query("update pilot_policy set uploads_enabled=false where id");
    const paused = await send(bytes, randomUUID());
    assert.equal(paused.status, 503);
    assert.equal((await paused.json()).code, "STORAGE_UNAVAILABLE", "the upload pause remains distinguishable through the safe error code");
    assert.equal(Number((await schemaPool.query("select count(*) from pilot_upload where owner_id=$1", [ownerId])).rows[0].count), 2);
    assert.equal(blobRequests.filter((entry) => entry.startsWith("PUT ")).length, 3);
  } finally {
    blobServer.close();
    await schemaPool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
    process.env = previousEnv;
  }
});
