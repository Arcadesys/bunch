import { requirePilotIdentity } from "@/server/auth";
import { getPilotService } from "@/server/pilot-service";
import { apiResponse } from "@/server/http-api";
import { canShareGallery } from "@/server/gallery-access";
export const runtime = "nodejs";
export async function GET() {
  return apiResponse(async () => {
    const identity = await requirePilotIdentity();
    const pilot = getPilotService();
    const a = await pilot.account(identity.ownerId);
    const galleryAccess = await canShareGallery(pilot.pool, identity.ownerId);
    const used = a
      ? Number(
          (
            await pilot.pool.query(
              "select coalesce(sum(bytes),0) as n from pilot_upload where owner_id=$1",
              [identity.ownerId],
            )
          ).rows[0].n,
        )
      : 0;
    return Response.json(
      {
        data: {
          signedIn: true,
          emailVerified: identity.emailVerified,
          state: a?.state ?? (galleryAccess ? "LEGACY" : "NOT_ENROLLED"),
          canShareGallery: galleryAccess,
          role: a?.role,
          displayName: a?.display_name,
          usedBytes: used,
          quotaBytes: a ? Number(a.quota_bytes) : 0,
        },
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}
