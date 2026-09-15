import type { Pool } from "pg";
import { z } from "zod";
import { getDatabasePool } from "@/db/client";
import type { GeneratedGalleryPage } from "@/domain/generated-gallery";
import { SystemError } from "./system-error";

const cursorSchema = z.object({ createdAt: z.string().datetime(), kind: z.enum(["scene", "group"]), id: z.string().uuid() });
const pageSize = 24;

/** Read only completed, owner-scoped outputs. Browsing never starts a provider job. */
export async function listGeneratedPhotos(ownerId: string, cursor?: string | null, pool: Pool = getDatabasePool()): Promise<GeneratedGalleryPage> {
  let after: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try {
      if (cursor.length > 512) throw new Error("Invalid cursor");
      after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    } catch { throw new SystemError("VALIDATION_ERROR", "This gallery page link is invalid. Open the gallery again."); }
  }
  const result = await pool.query(`
    with photos as (
      select id, 'scene'::text as kind, created_at, null::uuid as project_id,
        coalesce(recipe->>'scene', 'Generated image') as description, width, height
      from native_scene_render where owner_id=$1 and state='COMPLETE' and storage_key is not null
      union all
      select id, 'group'::text as kind, created_at, project_id,
        'Group photo'::text as description, width, height
      from group_photo_render where owner_id=$1 and state='COMPLETE' and storage_key is not null
    )
    select *, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_time
    from photos
    where ($2::timestamptz is null or (created_at,kind,id) < ($2::timestamptz,$3::text,$4::uuid))
    order by created_at desc, kind desc, id desc limit $5
  `, [ownerId, after?.createdAt ?? null, after?.kind ?? null, after?.id ?? null, pageSize + 1]);
  const rows = result.rows.slice(0, pageSize);
  const last = rows.at(-1);
  return {
    data: rows.map(row => ({
      id: String(row.id), kind: row.kind, createdAt: new Date(row.created_at).toISOString(),
      description: String(row.description), width: row.width, height: row.height,
      imageUrl: row.kind === "scene" ? `/api/v1/native-scenes/renders/${row.id}/image` : `/api/v1/group-photos/${row.project_id}/renders/${row.id}/image`,
      sourceUrl: row.kind === "scene" ? `/images?render=${row.id}` : `/group-photo?project=${row.project_id}`,
    })),
    meta: { nextCursor: result.rows.length > pageSize && last ? Buffer.from(JSON.stringify({ createdAt: last.cursor_time, kind: last.kind, id: last.id })).toString("base64url") : null },
  };
}
