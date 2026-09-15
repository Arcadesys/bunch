import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { getDatabasePool } from "@/db/client";

import { canShareGallery, galleryAccessPredicate } from "./gallery-access";
import { SystemError } from "./system-error";

const lifetimeMilliseconds = {
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  forever: null,
} as const;

export type GalleryShareLifetime = keyof typeof lifetimeMilliseconds;
export type GalleryShare = { id: string; showCurrentFronting: boolean; expiresAt: string | null; revokedAt: string | null; createdAt: string };
export type PublicGallery = {
  // This ID distinguishes people with the same displayed name. It is not an
  // owner identifier and is only used for client-side navigation.
  alters: Array<{ id: string; name: string; images: Array<{ id: string; contentType: string; role: "profile" | "image"; order: number }> }>;
  currentFronting?: { people: Array<{ id: string; name: string }>; checkedAt: string };
  generalImages: Array<{ id: string; contentType: string; role: "image"; order: number }>;
};

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const date = (value: unknown) => new Date(String(value)).toISOString();

export class GalleryShareService {
  constructor(readonly pool: Pool = getDatabasePool()) {}

  private async assertAccess(ownerId: string) {
    if (!await canShareGallery(this.pool, ownerId))
      throw new SystemError("FORBIDDEN", "Gallery sharing is unavailable for this account.");
  }

  async create(ownerId: string, lifetime: GalleryShareLifetime) {
    await this.assertAccess(ownerId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = lifetimeMilliseconds[lifetime] === null ? null : new Date(Date.now() + lifetimeMilliseconds[lifetime]).toISOString();
    const row = (await this.pool.query(
      "insert into gallery_share(owner_id,token_hash,expires_at) values($1,$2,$3) returning id,expires_at,revoked_at,created_at,show_current_fronting",
      [ownerId, tokenHash(token), expiresAt],
    )).rows[0];
    return { token, share: this.toShare(row) };
  }

  async list(ownerId: string): Promise<GalleryShare[]> {
    await this.assertAccess(ownerId);
    const rows = (await this.pool.query("select id,expires_at,revoked_at,created_at,show_current_fronting from gallery_share where owner_id=$1 order by created_at desc", [ownerId])).rows;
    return rows.map((row) => this.toShare(row));
  }

  async revoke(ownerId: string, id: string) {
    await this.assertAccess(ownerId);
    return (await this.pool.query("update gallery_share set revoked_at=coalesce(revoked_at,now()) where owner_id=$1 and id=$2::uuid returning id", [ownerId, id])).rowCount === 1;
  }

  async setCurrentFronting(ownerId: string, id: string, enabled: boolean): Promise<GalleryShare> {
    await this.assertAccess(ownerId);
    const row = (await this.pool.query(
      `update gallery_share set show_current_fronting=$3 where owner_id=$1 and id=$2::uuid
       and revoked_at is null and (expires_at is null or expires_at>now())
       returning id,expires_at,revoked_at,created_at,show_current_fronting`, [ownerId, id, enabled],
    )).rows[0];
    if (!row) throw new SystemError("NOT_FOUND", "Active gallery link not found.");
    return this.toShare(row);
  }

  // This check intentionally runs for every public metadata and image request.
  async publicOwner(token: string): Promise<string | null> {
    return (await this.publicShare(token))?.ownerId ?? null;
  }

  private async publicShare(token: string) {
    const row = (await this.pool.query(
      `select s.owner_id, s.show_current_fronting from gallery_share s join app_user u on u.id=s.owner_id
       left join pilot_account a on a.owner_id=u.id cross join pilot_policy p
       where s.token_hash=$1 and s.revoked_at is null and (s.expires_at is null or s.expires_at>now()) and ${galleryAccessPredicate} limit 1`,
      [tokenHash(token)],
    )).rows[0];
    return row ? { ownerId: String(row.owner_id), showCurrentFronting: row.show_current_fronting === true } : null;
  }

  async publicGallery(token: string): Promise<PublicGallery | null> {
    const share = await this.publicShare(token);
    if (!share) return null;
    const { ownerId } = share;
    const rows = (await this.pool.query(
      `select a.id as alter_id, a.name, i.id, i.content_type, i.is_profile_picture, i.created_at
       from alter_profile a left join private_image i on i.owner_id=a.owner_id and i.alter_id=a.id
       where a.owner_id=$1 order by a.created_at asc, i.is_profile_picture desc, i.created_at asc, i.id asc`, [ownerId],
    )).rows;
    const byId = new Map<string, PublicGallery["alters"][number]>();
    const alters = rows.reduce<PublicGallery["alters"]>((all, row) => {
      let alter = byId.get(String(row.alter_id));
      if (!alter) { alter = { id: String(row.alter_id), name: String(row.name), images: [] }; byId.set(String(row.alter_id), alter); all.push(alter); }
      if (row.id) alter.images.push({ id: String(row.id), contentType: String(row.content_type), role: row.is_profile_picture ? "profile" : "image", order: alter.images.length });
      return all;
    }, []);
    // Current schema requires an alter_id, but retain this section for legacy rows if that changes.
    const generalRows = (await this.pool.query(
      "select id,content_type from private_image where owner_id=$1 and alter_id is null order by created_at asc,id asc", [ownerId],
    )).rows;
    let currentFronting: PublicGallery["currentFronting"];
    if (share.showCurrentFronting) {
      const active = (await this.pool.query(
        `select alter_id from presence_period where owner_id=$1 and kind='FRONTING'
         and ended_at is null and started_at<=now() order by started_at,id`, [ownerId],
      )).rows;
      // Project onto the already authorized portfolio; never expose presence-only identities or fields.
      const ids = new Set(active.map(row => String(row.alter_id)));
      currentFronting = { people: alters.filter(alter => ids.has(alter.id)).map(({ id, name }) => ({ id, name })), checkedAt: new Date().toISOString() };
    }
    return { alters, ...(currentFronting ? { currentFronting } : {}), generalImages: generalRows.map((row, order) => ({ id: String(row.id), contentType: String(row.content_type), role: "image", order })) };
  }

  async publicImage(token: string, imageId: string) {
    const ownerId = await this.publicOwner(token);
    if (!ownerId) return null;
    const row = (await this.pool.query("select storage_key,content_type from private_image where owner_id=$1 and id=$2::uuid limit 1", [ownerId, imageId])).rows[0];
    return row ? { storageKey: String(row.storage_key), contentType: String(row.content_type) } : null;
  }

  private toShare(row: Record<string, unknown>): GalleryShare {
    return { id: String(row.id), showCurrentFronting: row.show_current_fronting === true, expiresAt: row.expires_at ? date(row.expires_at) : null, revokedAt: row.revoked_at ? date(row.revoked_at) : null, createdAt: date(row.created_at) };
  }
}

let singleton: GalleryShareService | undefined;
export function getGalleryShareService() { return singleton ??= new GalleryShareService(); }
