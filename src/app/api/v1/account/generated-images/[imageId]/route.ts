import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { readPrivateImage } from "@/server/private-images";
import { uuidSchema } from "@/domain/contracts";

export const runtime = "nodejs";

/** Export downloads remain available to revoked owners, just like profile images. */
export async function GET(_request: Request, { params }: { params: Promise<{ imageId: string }> }) {
  try {
    const { ownerId } = await requirePilotIdentity();
    const pilot = getPilotService();
    const account = await pilot.account(ownerId);
    if (!account || !["ACTIVE", "REVOKED"].includes(account.state)) return new Response("Unavailable", { status: 403 });
    await pilot.rate(ownerId, "image");
    const imageId = uuidSchema.parse((await params).imageId);
    const row = (await pilot.pool.query("select storage_key from native_scene_render where owner_id=$1 and id=$2::uuid and state='COMPLETE'", [ownerId, imageId])).rows[0];
    if (!row) return new Response("Not found", { status: 404 });
    const stored = await readPrivateImage(row.storage_key);
    return new Response(stored.body, { headers: {
      "Cache-Control": "private, no-store", "Content-Type": stored.contentType,
      "Content-Disposition": `attachment; filename="bunch-${imageId}.jpg"`, "X-Content-Type-Options": "nosniff",
    } });
  } catch { return new Response("Unavailable", { status: 403 }); }
}
