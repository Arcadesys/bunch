import { readFile, stat } from "node:fs/promises";

type Request = { uploadEndpoint: string; uploadCapability: string; alterId: string; path: string; filename: string; contentType: "image/jpeg" | "image/png" | "image/webp" };
const maxBytes = 5 * 1024 * 1024;

async function readRequest() {
  return new Promise<string>((resolve, reject) => {
    let buffer = "", settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      process.stdin.destroy();
      if (!value.trim()) reject(new Error("Private save request is required.")); else resolve(value.trim());
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd >= 0) finish(buffer.slice(0, lineEnd));
    });
    process.stdin.once("end", () => finish(buffer));
    process.stdin.once("error", reject);
  });
}

async function main() {
  const input = JSON.parse(await readRequest()) as Request;
  const endpoint = new URL(input.uploadEndpoint);
  const localTestEndpoint = process.env.NODE_ENV === "test" && endpoint.protocol === "http:" && endpoint.hostname === "127.0.0.1";
  const configuredOrigin = process.env.SYSTEM_PUBLIC_ORIGIN;
  if (
    (endpoint.protocol !== "https:" && !localTestEndpoint)
    || endpoint.pathname !== "/api/mcp-furry-result-upload"
    || (!localTestEndpoint && (!configuredOrigin || endpoint.origin !== new URL(configuredOrigin).origin))
  ) throw new Error("Invalid generated-result upload endpoint.");
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

void main().catch((error) => { process.stderr.write(`Private gallery save failed: ${error instanceof Error ? error.message : "unknown"}\n`); process.exitCode = 1; });
