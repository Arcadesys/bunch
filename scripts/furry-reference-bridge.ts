import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { materializeAuthorizedReferenceMedia, type AuthorizedReferenceMedia } from "../src/server/furry-transform-media";

type MaterializeRequest = { action: "materialize"; publicOrigin: string; referenceMedia: AuthorizedReferenceMedia[] };
type CleanupRequest = { action: "cleanup"; directory: string };

// Codex PTY writes do not close stdin. A single JSON line lets the bridge run
// immediately after write_stdin, while EOF remains accepted for shell use.
async function readRequest() {
  return new Promise<string>((resolve, reject) => {
    let buffer = "", settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      // A PTY stays open after write_stdin; release this process's input handle
      // once the complete one-line request has arrived.
      process.stdin.destroy();
      if (!value.trim()) reject(new Error("Bridge request is required.")); else resolve(value.trim());
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

function isBridgeDirectory(directory: string) {
  const root = resolve(tmpdir());
  const target = resolve(directory);
  return dirname(target) === root && basename(target).startsWith("diddy-furry-");
}

async function main() {
  const input = JSON.parse(await readRequest()) as MaterializeRequest | CleanupRequest;
  if (input.action === "materialize") {
    const result = await materializeAuthorizedReferenceMedia(input.referenceMedia, input.publicOrigin);
    // Deliberately emit local paths only. The incoming capabilities never appear in stdout.
    process.stdout.write(`${JSON.stringify({ paths: result.paths, directory: dirname(result.paths[0]) })}\n`);
    return;
  }
  if (input.action === "cleanup" && isBridgeDirectory(input.directory)) {
    const { rm } = await import("node:fs/promises");
    await rm(input.directory, { recursive: true, force: true });
    process.stdout.write('{"cleaned":true}\n');
    return;
  }
  throw new Error("Invalid bridge request.");
}

void main().catch((error) => { process.stderr.write(`Furry reference bridge failed: ${error instanceof Error ? error.message : "unknown"}\n`); process.exitCode = 1; });
