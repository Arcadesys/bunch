import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { deletePrivateImages, readPrivateImage } from "./private-images";
import { issueFurryResultUploadCapability } from "./mcp-authorization";
import { SystemService } from "./system-service";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? test : test.skip;

function resultRequest(capability: string, alterId: string, bytes: ArrayBuffer) {
  const form = new FormData();
  form.append("image", new File([bytes], "keeper.png", { type: "image/png" }));
  form.append("alterId", alterId);
  return new Request("http://localhost/api/mcp-furry-result-upload", { method: "POST", headers: { authorization: `Bearer ${capability}` }, body: form });
}

integration("generated-result route stores exact bytes once and rejects mismatched or foreign retries", async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.SYSTEM_DEMO_MODE = "true";
  process.env.MCP_TOKEN_SIGNING_SECRET = "generated-result-route-test-secret";
  const { POST } = await import("@/app/api/mcp-furry-result-upload/route");
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const service = new SystemService(pool, async () => undefined);
  const owner = `test:${randomUUID()}`;
  const foreignOwner = `test:${randomUUID()}`;
  const requestId = randomUUID();
  const bytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 7]).buffer;
  let storageKey: string | undefined;
  try {
    const alter = await service.createAlter(owner, { requestId: randomUUID(), name: "Route keeper" }, "SYSTEM");
    const capability = issueFurryResultUploadCapability(owner, alter.data.id, requestId);
    const first = await POST(resultRequest(capability, alter.data.id, bytes));
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { stored: true, replayed: false, profilePictureChanged: false });
    const replay = await POST(resultRequest(capability, alter.data.id, bytes));
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { stored: true, replayed: true, profilePictureChanged: false });
    const mismatch = await POST(resultRequest(capability, alter.data.id, Uint8Array.from([...new Uint8Array(bytes), 9]).buffer));
    assert.equal(mismatch.status, 409);
    const foreign = await POST(resultRequest(issueFurryResultUploadCapability(foreignOwner, alter.data.id, randomUUID()), alter.data.id, bytes));
    assert.equal(foreign.status, 404);

    const images = await pool.query<{ storage_key: string; is_profile_picture: boolean }>("select storage_key, is_profile_picture from private_image where owner_id=$1 and alter_id=$2::uuid", [owner, alter.data.id]);
    assert.equal(images.rowCount, 1);
    storageKey = images.rows[0].storage_key;
    assert.equal(images.rows[0].is_profile_picture, false);
    assert.deepEqual(Buffer.from(await readPrivateImage(storageKey).then(image => image.body as Buffer)), Buffer.from(new Uint8Array(bytes)));
    assert.equal((await pool.query("select count(*) from fronting_session where owner_id=$1", [owner])).rows[0].count, "0");
    assert.equal((await pool.query("select count(*) from system_host where owner_id=$1", [owner])).rows[0].count, "0");
  } finally {
    if (storageKey) await deletePrivateImages([storageKey]);
    await pool.query("delete from app_user where id = any($1::text[])", [[owner, foreignOwner]]).catch(() => undefined);
    await pool.end();
  }
});
