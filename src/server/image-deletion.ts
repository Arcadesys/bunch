// One owner-scoped delete for every image a person can see: uploaded private photos,
// generated scenes, and group photo renders. Repairs made from an image are deleted
// with it, because a repair is a copy of the original and would otherwise outlive it.
//
// Deleting your own data never depends on being ACTIVE: a REVOKED account keeps its
// export downloads, so it keeps the right to delete them too.

import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { getDatabasePool } from "@/db/client";
import { deletePrivateImages } from "./private-images";
import { deleteSharedGalleryImageCache } from "./shared-gallery-cache";
import { SystemError } from "./system-error";

export const deletableImageKindSchema = z.enum(["upload", "scene", "group"]);
export type DeletableImageKind = z.infer<typeof deletableImageKindSchema>;

type Dependencies = {
  removeFiles?: (storageKeys: string[]) => Promise<void>;
  purgeSharedGalleryCache?: (imageId: string) => Promise<{ deleted: boolean }>;
};

// Every native repair descending from the given seed rows, including repairs of repairs.
const repairDescendants = (seed: string) => `with recursive descendants as (
  select id,storage_key from native_scene_render where owner_id=$1 and ${seed}
  union all select n.id,n.storage_key from native_scene_render n join descendants d on n.source_native_id=d.id where n.owner_id=$1
) select id,storage_key from descendants`;

export class ImageDeletionService {
  private removeFiles: (storageKeys: string[]) => Promise<void>;
  private purgeSharedGalleryCache: (imageId: string) => Promise<{ deleted: boolean }>;
  constructor(private pool: Pool = getDatabasePool(), dependencies: Dependencies = {}) {
    this.removeFiles = dependencies.removeFiles ?? deletePrivateImages;
    this.purgeSharedGalleryCache = dependencies.purgeSharedGalleryCache ?? deleteSharedGalleryImageCache;
  }

  /** Idempotent: an image that is already gone (or never belonged to this owner) reports deleted: false. */
  async delete(ownerId: string, kind: DeletableImageKind, imageId: string): Promise<{ deleted: boolean }> {
    const deleted = await this.transaction(async (client) => {
      await client.query("select id from app_user where id=$1 for update", [ownerId]);
      await this.assertCanDelete(client, ownerId);
      // The row-level pilot guard only admits ACTIVE owners. assertCanDelete has already
      // decided this owner may delete, so lift the guard for this transaction only.
      await client.query("select set_config('app.pilot_purge',$1,true)", [ownerId]);
      if (kind === "upload") return this.deleteUpload(client, ownerId, imageId);
      return this.deleteRender(client, ownerId, kind, imageId);
    });
    // Only uploaded photos appear in shared galleries.
    if (deleted && kind === "upload") {
      const purge = await this.purgeSharedGalleryCache(imageId);
      if (!purge.deleted) throw new Error("The image was deleted, but its shared-gallery edge cache still needs deletion.");
    }
    return { deleted };
  }

  private async assertCanDelete(client: PoolClient, ownerId: string) {
    const account = (await client.query("select state from pilot_account where owner_id=$1 for update", [ownerId])).rows[0];
    if (account) {
      if (!["ACTIVE", "REVOKED"].includes(account.state)) throw new SystemError("FORBIDDEN", "Account access is unavailable.");
      return;
    }
    // Mirrors PilotService.assertAccess: an unenrolled owner is allowed only while the gate is off.
    const policy = (await client.query("select gate_enabled from pilot_policy where id")).rows[0];
    if (!policy || policy.gate_enabled) throw new SystemError("FORBIDDEN", "Account access is unavailable.");
  }

  private async deleteUpload(client: PoolClient, ownerId: string, imageId: string) {
    const image = (await client.query("select storage_key,alter_id from private_image where owner_id=$1 and id=$2::uuid", [ownerId, imageId])).rows[0];
    if (!image) return false;
    const repairs = (await client.query(repairDescendants("source_private_id=$2::uuid"), [ownerId, imageId])).rows;
    await this.removeStored(client, ownerId, [image.storage_key, ...await this.derivedKeys(client, ownerId, repairs, { private: imageId })]);
    await client.query("delete from private_image where owner_id=$1 and id=$2::uuid", [ownerId, imageId]);
    await client.query("update alter_profile set version=version+1,updated_at=now() where owner_id=$1 and id=$2", [ownerId, image.alter_id]);
    return true;
  }

  private async deleteRender(client: PoolClient, ownerId: string, kind: "scene" | "group", imageId: string) {
    const table = kind === "scene" ? "native_scene_render" : "group_photo_render";
    const render = (await client.query(`select state,storage_key from ${table} where owner_id=$1 and id=$2::uuid`, [ownerId, imageId])).rows[0];
    if (!render) return false;
    if (["QUEUED", "RUNNING"].includes(render.state))
      throw new SystemError("CONFLICT", "This image is still being made. Wait for it to finish, then delete it.");
    const repairs = (await client.query(repairDescendants(kind === "scene" ? "source_native_id=$2::uuid" : "source_group_id=$2::uuid"), [ownerId, imageId])).rows;
    const derived = await this.derivedKeys(client, ownerId, repairs, kind === "scene" ? { native: imageId } : { group: imageId });
    await this.removeStored(client, ownerId, [render.storage_key, ...derived].filter((key): key is string => typeof key === "string"));
    // Repair rows cascade from their source. The image_usage ledger is kept: it records spend, not images.
    await client.query(`delete from ${table} where owner_id=$1 and id=$2::uuid`, [ownerId, imageId]);
    return true;
  }

  /** Storage keys of repairs plus every display rendition of the source and its repairs. */
  private async derivedKeys(client: PoolClient, ownerId: string, repairs: { id: string; storage_key: string | null }[], source: { private?: string; native?: string; group?: string }) {
    const nativeIds = [...(source.native ? [source.native] : []), ...repairs.map((r) => String(r.id))];
    const renditions = await client.query(
      "select storage_key from image_rendition where owner_id=$1 and (source_native_id=any($2::uuid[]) or source_private_id=$3::uuid or source_group_id=$4::uuid)",
      [ownerId, nativeIds, source.private ?? null, source.group ?? null],
    );
    return [...repairs.map((r) => r.storage_key), ...renditions.rows.map((r) => r.storage_key)].filter((key): key is string => typeof key === "string");
  }

  // Files go first: if the commit then fails, the rows remain and a retry finds the same keys.
  private async removeStored(client: PoolClient, ownerId: string, keys: string[]) {
    if (!keys.length) return;
    await this.removeFiles(keys);
    await client.query("delete from pilot_upload where owner_id=$1 and storage_key=any($2::text[])", [ownerId, keys]);
  }

  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const value = await run(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

let imageDeletionService: ImageDeletionService | undefined;
export function getImageDeletionService() {
  return (imageDeletionService ??= new ImageDeletionService());
}
