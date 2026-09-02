import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { Client } from "pg";
import { deletePrivateImages, savePrivateImage } from "@/server/private-images";
import { repository } from "@/server/repository";

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function main() {
  const [profileName, imagePath, ...flags] = process.argv.slice(2);
  if (!profileName || !imagePath) throw new Error("Usage: attach-profile-image <profile-name> <image-path> [--allow-additional]");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

  const contentType = contentTypes[extname(imagePath).toLowerCase()];
  if (!contentType) throw new Error("Use a JPEG, PNG, or WebP image.");
  const allowAdditional = flags.includes("--allow-additional");
  const safeSourceName = basename(imagePath).replace(/[^a-zA-Z0-9._-]/g, "_");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const matches = await client.query<{ id: string; owner_id: string; image_count: number; duplicate_count: number }>(
      `select a.id, a.owner_id, count(i.id)::int as image_count,
         count(i.id) filter (where i.storage_key like '%' || $2 || '%')::int as duplicate_count
       from alter_profile a
       left join private_image i on i.owner_id = a.owner_id and i.alter_id = a.id
       where lower(a.name) = lower($1) and a.archived_at is null
       group by a.id, a.owner_id`,
      [profileName, safeSourceName],
    );
    if (matches.rowCount !== 1) throw new Error(`Expected exactly one active profile named ${profileName}; found ${matches.rowCount}.`);

    const profile = matches.rows[0];
    if (profile.duplicate_count > 0) {
      console.log(`${profileName} already has this private image; no changes made.`);
    } else if (profile.image_count > 0 && !allowAdditional) {
      throw new Error(`${profileName} already has ${profile.image_count} private image(s). Pass --allow-additional to attach another.`);
    } else {
      const bytes = await readFile(imagePath);
      const file = new File([bytes], basename(imagePath), { type: contentType });
      const saved = await savePrivateImage(profile.owner_id, file);
      try {
        await repository.attachImage(profile.owner_id, profile.id, { id: randomUUID(), ...saved });
      } catch (error) {
        await deletePrivateImages([saved.storageKey]);
        throw error;
      }
      console.log(`Attached one private image to ${profileName}.`);
    }
  } finally {
    await client.end();
  }
}

void main();
