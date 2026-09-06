import type { Pool } from "pg";

// The same eligibility for account controls, share management, and public reads.
// u is an existing app_user, a is its optional pilot_account, p is pilot_policy.
// Legacy access never assigns a pilot role or changes an owner's identity.
export const galleryAccessPredicate = `p.id AND (
  (a.state='ACTIVE' AND (a.role='OPERATOR' OR p.friends_enabled))
  OR (a.owner_id IS NULL AND NOT p.gate_enabled)
)`;

export async function canShareGallery(pool: Pool, ownerId: string): Promise<boolean> {
  const result = await pool.query(
    `select u.id from app_user u left join pilot_account a on a.owner_id=u.id
     cross join pilot_policy p where u.id=$1 AND ${galleryAccessPredicate}`,
    [ownerId],
  );
  return result.rows.length > 0;
}
