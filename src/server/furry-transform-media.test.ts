import assert from "node:assert/strict";
import test from "node:test";
import { readFile, stat } from "node:fs/promises";
import { materializeAuthorizedReferenceMedia } from "./furry-transform-media";

const media = [{ role: "character_reference" as const, src: "https://system.arcades.me/api/system/images/inline/11111111-1111-4111-8111-111111111111?cap=synthetic", contentType: "image/png" as const }];

test("materializes authorized reference metadata privately and removes it on cleanup", async () => {
  const result = await materializeAuthorizedReferenceMedia(media, "https://system.arcades.me", async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png", "content-length": "4" } }));
  assert.equal(result.paths.length, 1);
  assert.deepEqual([...await readFile(result.paths[0])], [137, 80, 78, 71]);
  assert.equal((await stat(result.paths[0])).mode & 0o777, 0o600);
  await result.cleanup();
  await assert.rejects(stat(result.paths[0]));
});

test("rejects a non-DIDdy origin before fetching", async () => {
  await assert.rejects(materializeAuthorizedReferenceMedia([{ ...media[0], src: "https://attacker.invalid/api/system/images/inline/id?cap=nope" }], "https://system.arcades.me"), /authorized DIDdy/);
});
