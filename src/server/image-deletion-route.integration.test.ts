// End-to-end regression coverage for the delete-image bug reported in #bugs: the routes
// returned a bare 500 ("The server could not complete the request.") with no indication
// of why. image-deletion.integration.test.ts exercises ImageDeletionService directly with
// a mocked removeFiles, so it never touches the real dependency chain
// (route -> ImageDeletionService -> deletePrivateImages -> @vercel/blob) where the bug
// actually lived. This file drives the real DELETE route handlers against a real Postgres
// schema and a fake Vercel Blob HTTP endpoint, so it reproduces the two real-world
// failures found while diagnosing the report:
//   - the `image_rendition` table missing from a database that has not run every
//     migration (drizzle/0023_image_renditions.sql), and
//   - the blob store rejecting a delete.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;

// A minimal stand-in for the Vercel Blob HTTP API: enough for @vercel/blob's del() to
// succeed or fail on command, and to record which storage keys it was asked to delete.
function startFakeBlobApi(respond: () => { status: number; body: unknown }) {
  const deletes: string[][] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.url === "/delete") deletes.push((JSON.parse(body) as { urls: string[] }).urls);
      const { status, body: replyBody } = respond();
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(replyBody));
    });
  });
  return { server, deletes };
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return (server.address() as AddressInfo).port;
}

integration("delete routes reproduce and survive the real storage and schema failures behind the bug report", async () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `image_deletion_route_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const schemaUrl = new URL(process.env.TEST_DATABASE_URL!);
  schemaUrl.searchParams.set("options", `-c search_path=${schema},public`);

  const previousEnv = { ...process.env };
  process.env.DATABASE_URL = schemaUrl.toString();
  process.env.SYSTEM_E2E_TEST_MODE = "true";
  delete process.env.SYSTEM_DEMO_MODE;
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_fixture";
  // @vercel/blob retries a 500 up to 10 times with backoff by default; the fake
  // server below always fails on command, so retrying would make this test hang.
  process.env.VERCEL_BLOB_RETRIES = "0";

  let blob: ReturnType<typeof startFakeBlobApi> | undefined;
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema},public` });
  try {
    await pool.query(await readFile("db/baseline.sql", "utf8"));
    for (const file of (await readdir("drizzle")).filter((f) => f.endsWith(".sql")).sort())
      await pool.query(await readFile(`drizzle/${file}`, "utf8"));

    const { ownerIdFromAuth0Subject } = await import("@/server/auth");
    const subject = `auth0|route-diag-${randomUUID()}`;
    const ownerId = ownerIdFromAuth0Subject(subject);
    await pool.query("insert into app_user(id,google_subject) values($1,$1)", [ownerId]);
    await pool.query("insert into pilot_account(owner_id,role,state) values($1,'OPERATOR','ACTIVE')", [ownerId]);
    const alter = randomUUID();
    await pool.query("insert into alter_profile(id,owner_id,name) values($1,$2,'Photo profile')", [alter, ownerId]);

    const requestHeaders = { origin: "https://bunch.example", "x-system-e2e-subject": subject };
    const { DELETE: deleteGenerated } = await import("@/app/api/v1/account/generated-images/[imageId]/route");

    async function makeScene(storageKey: string) {
      const scene = randomUUID();
      await pool.query(
        `insert into native_scene_render(id,owner_id,request_id,state,model,recipe,storage_key,content_type,content_hash,width,height)
         values($1,$2,$3,'COMPLETE','m','{}'::jsonb,$4,'image/jpeg','h',1,1)`,
        [scene, ownerId, randomUUID(), storageKey],
      );
      return scene;
    }

    // --- Case 1: a healthy blob store and a fully migrated schema succeed. ---
    blob = startFakeBlobApi(() => ({ status: 200, body: {} }));
    process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${await listen(blob.server)}`;
    const healthyScene = await makeScene(`profiles/${randomUUID()}/healthy.jpg`);
    const healthyResponse = await deleteGenerated(
      new Request(`https://bunch.example/api/v1/account/generated-images/${healthyScene}?kind=scene`, { method: "DELETE", headers: requestHeaders }),
      { params: Promise.resolve({ imageId: healthyScene }) },
    );
    assert.equal(healthyResponse.status, 200);
    assert.deepEqual(await healthyResponse.json(), { deleted: true });
    assert.equal(blob.deletes.length, 1);
    blob.server.close();

    // --- Case 2: the schema predates drizzle/0023_image_renditions.sql. Before the fix
    // this reproduced the reported bug exactly: a bare 500 with no diagnostic detail. ---
    await pool.query("drop table image_rendition cascade");
    blob = startFakeBlobApi(() => ({ status: 200, body: {} }));
    process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${await listen(blob.server)}`;
    const unmigratedScene = await makeScene(`profiles/${randomUUID()}/unmigrated.jpg`);
    const unmigratedResponse = await deleteGenerated(
      new Request(`https://bunch.example/api/v1/account/generated-images/${unmigratedScene}?kind=scene`, { method: "DELETE", headers: requestHeaders }),
      { params: Promise.resolve({ imageId: unmigratedScene }) },
    );
    assert.equal(unmigratedResponse.status, 200, "a missing image_rendition table must not 500 the whole delete");
    assert.deepEqual(await unmigratedResponse.json(), { deleted: true });
    assert.equal(Number((await pool.query("select count(*) from native_scene_render where id=$1", [unmigratedScene])).rows[0].count), 0);
    blob.server.close();

    // --- Case 3: the blob store itself is unreachable/rejecting. The route must say so
    // (503 STORAGE_UNAVAILABLE) instead of a bare 500, and must not delete the row. ---
    blob = startFakeBlobApi(() => ({ status: 500, body: { error: { message: "internal error" } } }));
    process.env.VERCEL_BLOB_API_URL = `http://127.0.0.1:${await listen(blob.server)}`;
    const storageDownScene = await makeScene(`profiles/${randomUUID()}/storage-down.jpg`);
    const storageDownResponse = await deleteGenerated(
      new Request(`https://bunch.example/api/v1/account/generated-images/${storageDownScene}?kind=scene`, { method: "DELETE", headers: requestHeaders }),
      { params: Promise.resolve({ imageId: storageDownScene }) },
    );
    assert.equal(storageDownResponse.status, 503);
    assert.equal((await storageDownResponse.json()).error.code, "STORAGE_UNAVAILABLE");
    assert.equal(Number((await pool.query("select count(*) from native_scene_render where id=$1", [storageDownScene])).rows[0].count), 1, "the row must survive a failed storage delete");
    blob.server.close();
  } finally {
    blob?.server.close();
    await pool.end();
    await admin.query(`drop schema ${schema} cascade`);
    await admin.end();
    process.env = previousEnv;
  }
});
