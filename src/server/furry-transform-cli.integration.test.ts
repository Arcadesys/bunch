import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runScript(script: string, input: unknown) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("./node_modules/.bin/tsx", [script], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "test" }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `script exited ${code}`)));
    child.stdin.end(JSON.stringify(input));
  });
}

test("CLI bridge materializes, exposes to a separate consumer, and cleans up", async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const server = createServer((request, response) => { assert.equal(request.url, "/api/system/images/inline/synthetic?cap=test-capability"); response.writeHead(200, { "content-type": "image/png", "content-length": bytes.length }); response.end(bytes); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const materialized = JSON.parse((await runScript("scripts/furry-reference-bridge.ts", { action: "materialize", publicOrigin: `http://127.0.0.1:${port}`, referenceMedia: [{ role: "character_reference", src: `http://127.0.0.1:${port}/api/system/images/inline/synthetic?cap=test-capability`, contentType: "image/png" }] })).stdout);
    assert.equal(materialized.paths.length, 1);
    // A separate process boundary is represented by a fresh file read, as image_gen does.
    assert.deepEqual(await readFile(materialized.paths[0]), bytes);
    await runScript("scripts/furry-reference-bridge.ts", { action: "cleanup", directory: materialized.directory });
    await assert.rejects(stat(materialized.paths[0]));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("CLI keeper save sends bytes and is retry-safe at the transport boundary", async () => {
  const result = await mkdtemp(join(tmpdir(), "diddy-furry-result-"));
  const file = join(result, "keeper.png"); const bytes = Buffer.from([137, 80, 78, 71]); await writeFile(file, bytes);
  let requests = 0;
  const server = createServer(async (request, response) => { requests++; const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); assert.match(Buffer.concat(chunks).toString("binary"), /\x89PNG/); assert.equal(request.headers.authorization, "Bearer synthetic-capability"); response.writeHead(200, { "content-type": "application/json" }); response.end('{"stored":true}'); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const port = (server.address() as { port: number }).port;
  const input = { uploadEndpoint: `http://127.0.0.1:${port}/api/mcp-image-upload`, uploadCapability: "synthetic-capability", alterId: "11111111-1111-4111-8111-111111111111", path: file, filename: "keeper.png", contentType: "image/png" };
  try { assert.deepEqual(JSON.parse((await runScript("scripts/save-furry-transform-result.ts", input)).stdout), { stored: true, profilePictureChanged: false }); assert.deepEqual(JSON.parse((await runScript("scripts/save-furry-transform-result.ts", input)).stdout), { stored: true, profilePictureChanged: false }); assert.equal(requests, 2); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
