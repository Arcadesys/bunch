import { del } from "@vercel/blob";
import { apiResponse, requireSameOrigin } from "@/server/http-api";
import { SystemError } from "@/server/system-error";
import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { repository } from "@/server/repository";
import { readPrivateImage } from "@/server/private-images";
import { privateMediaError, privateMediaResponse } from "@/server/private-media-response";
import { uuidSchema } from "@/domain/contracts";
import { deleteSharedGalleryImageCache } from "@/server/shared-gallery-cache";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  try {
    const { ownerId } = await requirePilotIdentity();
    const pilot = getPilotService();
    const account = await pilot.account(ownerId);
    if (!account || !["ACTIVE", "REVOKED"].includes(account.state))
      return new Response("Unavailable", { status: 403 });
    await pilot.rate(ownerId, "image");
    const imageId = uuidSchema.parse((await params).imageId);
    const image = await repository.getImage(ownerId, imageId);
    if (!image) return new Response("Not found", { status: 404 });
    const stored = await readPrivateImage(image.storageKey, { ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
    return privateMediaResponse(request, stored, { contentDisposition: `attachment; filename="${imageId}"` });
  } catch {
    return privateMediaError("Unavailable", 403);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ imageId: string }> },
) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const { ownerId } = await requirePilotIdentity();
    const pilot = getPilotService();
    await pilot.assertAccess(ownerId, "upload");
    const imageId = uuidSchema.parse((await params).imageId);
    await pilot.transaction(async (c) => {
      await c.query("select id from app_user where id=$1 for update", [ownerId]);
      const account = (
        await c.query(
          "select state from pilot_account where owner_id=$1 for update",
          [ownerId],
        )
      ).rows[0];
      if (account?.state !== "ACTIVE")
        throw new SystemError("FORBIDDEN", "Account access is unavailable.");
      const image = (
        await c.query(
          "select storage_key,alter_id from private_image where owner_id=$1 and id=$2",
          [ownerId, imageId],
        )
      ).rows[0];
      if (!image) return; // Already deleted; retry succeeds.
      const repairs = await c.query(`with recursive descendants as (
        select id,storage_key from native_scene_render where owner_id=$1 and source_private_id=$2
        union all select n.id,n.storage_key from native_scene_render n join descendants d on n.source_native_id=d.id where n.owner_id=$1
      ) select storage_key from descendants where storage_key is not null`, [ownerId, imageId]);
      const keys = [image.storage_key, ...repairs.rows.map(r => String(r.storage_key))];
      await del(keys);
      await c.query("delete from private_image where owner_id=$1 and id=$2", [
        ownerId,
        imageId,
      ]);
      await c.query(
        "delete from pilot_upload where owner_id=$1 and storage_key=any($2::text[])",
        [ownerId, keys],
      );
      await c.query(
        "update alter_profile set version=version+1,updated_at=now() where owner_id=$1 and id=$2",
        [ownerId, image.alter_id],
      );
    });
    const purge = await deleteSharedGalleryImageCache(imageId);
    if (!purge.deleted) throw new Error("The image was deleted, but its shared-gallery edge cache still needs deletion.");
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
