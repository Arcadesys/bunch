import type { Pool } from "pg";
/** Return only an active owner's currently selected profile picture. */
export async function selectedAvatar(pool: Pool, owner: string, memberId: string) {
  const result=await pool.query<{storage_key:string; content_type:string}>(`select i.storage_key,i.content_type from private_image i join alter_profile a on a.owner_id=i.owner_id and a.id=i.alter_id where i.owner_id=$1 and a.id=$2::uuid and a.archived_at is null and i.is_profile_picture=true limit 1`,[owner,memberId]);
  return result.rows[0] ?? null;
}
