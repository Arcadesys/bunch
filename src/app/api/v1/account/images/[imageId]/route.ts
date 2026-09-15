import { del } from "@vercel/blob";
import { apiResponse, requireSameOrigin } from "@/server/http-api";
import { SystemError } from "@/server/system-error";
import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { repository } from "@/server/repository";
import { readPrivateImage } from "@/server/private-images";
import { uuidSchema } from "@/domain/contracts";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
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
    const stored = await readPrivateImage(image.storageKey);
    return new Response(stored.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": stored.contentType,
        "Content-Disposition": `attachment; filename="${imageId}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Unavailable", { status: 403 });
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
      await del([image.storage_key]);
      await c.query("delete from private_image where owner_id=$1 and id=$2", [
        ownerId,
        imageId,
      ]);
      await c.query(
        "delete from pilot_upload where owner_id=$1 and storage_key=$2",
        [ownerId, image.storage_key],
      );
      await c.query(
        "update alter_profile set version=version+1,updated_at=now() where owner_id=$1 and id=$2",
        [ownerId, image.alter_id],
      );
    });
    return Response.json(
      { deleted: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
