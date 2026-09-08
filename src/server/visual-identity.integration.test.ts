import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SystemService } from "./system-service";
import { SystemError } from "./system-error";
import { prepareAlterImagePrompt } from "./image-prompt";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

integrationTest("visual identity persists, searches, clears, and survives older patches with ownership and concurrency checks", async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const service = new SystemService(pool);
  const owner = `test:${randomUUID()}`;
  const fields = { species: "hare", visualDescription: "Elegant indigo-and-violet hare; glasses; nocturnal, composed, dark layered clothing.", presentation: "composed",
    signatureTraits: ["glasses", "long glorious ears", "cotton tail"], styleTags: ["gothic", "moonlit", "observant"], imageDoNotChange: ["species", "palette", "glasses"] };
  try {
    const created = await service.createAlter(owner, { requestId: randomUUID(), name: "Twilight Arcade", pronouns: "they/them", ...fields }, "MCP");
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(created.data[key as keyof typeof created.data], value);
    assert.deepEqual(JSON.parse(JSON.stringify(await service.getAlter(owner, created.data.id))), created.data);
    for (const search of ["hare", "MOONLIT"]) assert.equal((await service.listAlters(owner, { search })).data[0].id, created.data.id);
    const oldClient = await service.updateAlter(owner, created.data.id, { requestId: randomUUID(), expectedVersion: 1, description: "Biography only" }, "WEB");
    for (const [key, value] of Object.entries(fields)) assert.deepEqual(oldClient.data[key as keyof typeof oldClient.data], value);
    const patch = { requestId: randomUUID(), expectedVersion: 2, species: "hare hybrid" };
    const updated = await service.updateAlter(owner, created.data.id, patch, "MCP");
    assert.deepEqual(await service.updateAlter(owner, created.data.id, patch, "MCP"), { data: updated.data, replayed: true });
    await assert.rejects(service.updateAlter(owner, created.data.id, { ...patch, requestId: randomUUID() }, "MCP"), (error) => error instanceof SystemError && error.code === "CONFLICT");
    await assert.rejects(service.getAlter("test:other-owner", created.data.id), (error) => error instanceof SystemError && error.code === "NOT_FOUND");
    assert.equal((await service.listAlters("test:other-owner", { search: "hare" })).data.length, 0);
    const cleared = await service.updateAlter(owner, created.data.id, { requestId: randomUUID(), expectedVersion: 3, species: null, visualDescription: null, presentation: null, signatureTraits: [], styleTags: [], imageDoNotChange: [] }, "WEB");
    assert.equal(cleared.data.species, undefined);
    assert.equal(cleared.data.visualDescription, undefined);
    assert.equal(cleared.data.presentation, undefined);
    assert.deepEqual(cleared.data.signatureTraits, []);
    assert.deepEqual(cleared.data.styleTags, []);
    assert.deepEqual(cleared.data.imageDoNotChange, []);
    assert.equal(cleared.data.pronouns, "they/them");
    const legacy = await service.createAlter(owner, { requestId: randomUUID(), name: "Older client" }, "WEB");
    assert.equal(legacy.data.species, undefined);
    assert.deepEqual(legacy.data.signatureTraits, []);
  } finally {
    await pool.query("delete from app_user where id = $1", [owner]);
    await pool.end();
  }
});

integrationTest("draw everyone prepares more than one database page and excludes archived and foreign profiles", async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const service = new SystemService(pool);
  const owner = `test:${randomUUID()}`;
  const otherOwner = `test:${randomUUID()}`;
  try {
    await service.createAlter(owner, { requestId: randomUUID(), name: "Twi", species: "hare", visualDescription: "Indigo-and-violet hare with glasses and long glorious ears." }, "MCP");
    await service.createAlter(otherOwner, { requestId: randomUUID(), name: "Foreign" }, "MCP");
    await pool.query("insert into alter_profile (owner_id, name, species, visual_description, created_at) select $1, 'Synthetic ' || n, 'hare', 'Violet hare', '2026-09-08T12:00:00.123456Z'::timestamptz from generate_series(1, 101) n", [owner]);
    const archived = await service.createAlter(owner, { requestId: randomUUID(), name: "Archived" }, "MCP");
    await service.archiveAlter(owner, archived.data.id, { requestId: randomUUID(), expectedVersion: 1 }, "MCP");
    const result = await prepareAlterImagePrompt(service, owner, { scene: "Draw everyone", alters: "all" }, "https://example.invalid");
    assert.equal(result.structuredContent.ready, true);
    assert.equal(result.structuredContent.identities.length, 102);
    assert.equal(new Set(result.structuredContent.identities.map((identity) => identity.alterId)).size, 102);
    assert.ok(result.structuredContent.identities.some((identity) => identity.alterName === "Twi"));
    assert.ok(result.structuredContent.identities.every((identity) => !["Archived", "Foreign"].includes(identity.alterName)));
    await assert.rejects(prepareAlterImagePrompt(service, owner, { scene: "Portrait", alters: [archived.data.id] }, "https://example.invalid"), (error) => error instanceof SystemError && error.code === "NOT_FOUND");
  } finally {
    await pool.query("delete from app_user where id = any($1::text[])", [[owner, otherOwner]]);
    await pool.end();
  }
});
