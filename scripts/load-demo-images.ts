import { access, copyFile, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";

const people = ["benny", "fenton", "dot"] as const;
const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function readArg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`Missing --${name} image path.`);
  return resolve(value);
}

async function main() {
  const sourceByPerson = Object.fromEntries(people.map((person) => [person, readArg(person)])) as Record<(typeof people)[number], string>;
  const targetDir = join(process.cwd(), "public", "demo", "people");
  await mkdir(targetDir, { recursive: true });
  for (const person of people) {
    const source = sourceByPerson[person];
    await access(source);
    if (!allowedExtensions.has(extname(source).toLowerCase())) throw new Error(`${basename(source)} must be a PNG, JPEG, or WebP image.`);
    await copyFile(source, join(targetDir, `${person}.png`));
  }
  console.log(`Loaded ${people.length} demo profile pictures into ${targetDir}. Runtime demo access remains read-only.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
