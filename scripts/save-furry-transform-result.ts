import { readFile, stat } from "node:fs/promises";

type Request = { uploadEndpoint: string; uploadCapability: string; alterId: string; path: string; filename: string; contentType: "image/jpeg" | "image/png" | "image/webp" };
const maxBytes = 5 * 1024 * 1024;

async function main() {
  const input = JSON.parse(await readFile(0, "utf8")) as Request;
  const endpoint = new URL(input.uploadEndpoint);
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/api/mcp-image-upload") throw new Error("Invalid private upload endpoint.");
  if (!input.alterId || !input.uploadCapability || !input.filename) throw new Error("Invalid private save request.");
  const info = await stat(input.path);
  if (!info.isFile() || info.size > maxBytes) throw new Error("Result image must be a file of 5 MB or less.");
  const bytes = await readFile(input.path);
  const form = new FormData();
  form.append("image", new Blob([bytes], { type: input.contentType }), input.filename);
  form.append("alterId", input.alterId);
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${input.uploadCapability}` }, body: form, redirect: "error" });
  if (!response.ok) throw new Error("Private gallery save failed.");
  // No capability, storage key, or URL is printed.
  process.stdout.write('{"stored":true,"profilePictureChanged":false}\n');
}

void main().catch(() => { process.stderr.write("Private gallery save failed.\n"); process.exitCode = 1; });
