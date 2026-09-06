import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { materializeAuthorizedReferenceMedia, type AuthorizedReferenceMedia } from "../src/server/furry-transform-media";

type MaterializeRequest = { action: "materialize"; publicOrigin: string; referenceMedia: AuthorizedReferenceMedia[] };
type CleanupRequest = { action: "cleanup"; directory: string };

function isBridgeDirectory(directory: string) {
  const root = resolve(tmpdir());
  const target = resolve(directory);
  return dirname(target) === root && basename(target).startsWith("diddy-furry-");
}

async function main() {
  const input = JSON.parse(await readFile(0, "utf8")) as MaterializeRequest | CleanupRequest;
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

void main().catch(() => { process.stderr.write("Furry reference bridge failed.\n"); process.exitCode = 1; });
