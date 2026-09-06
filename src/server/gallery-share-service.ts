import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { getDatabasePool } from "@/db/client";

const lifetimeMilliseconds = {
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  forever: null,
} as const;

export type GalleryShareLifetime = keyof typeof lifetimeMilliseconds;
export type GalleryShare = { id: string; expiresAt: string | null; revokedAt: string | null; createdAt: string };
export type PublicGallery = {
  // This ID distinguishes people with the same displayed name. It is not an
  // owner identifier and is only used for client-side navigation.
  alters: Array<{ id: string; name: string; images: Array<{ id: string; contentType: string; role: "profile" | "image"; order: number }> }>;
  generalImages: Array<{ id: string; contentType: string; role: "image"; order: number }>;
};

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const date = (value: unknown) => new Date(String(value)).toISOString();

export class GalleryShareService {
  constructor(readonly pool: Pool = getDatabasePool()) {}

  async create(ownerId: string, lifetime: GalleryShareLifetime) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = lifetimeMilliseconds[lifetime] === null ? null : new Date(Date.now() + lifetimeMilliseconds[lifetime]).toISOString();
    const row = (await this.pool.query(
      "insert into gallery_share(owner_id,token_hash,expires_at) values($1,$2,$3) returning id,expires_at,revoked_at,created_at",
      [ownerId, tokenHash(token), expiresAt],
    )).rows[0];
    return { token, share: this.toShare(row) };
  }

  async list(ownerId: string): Promise<GalleryShare[]> {
    const rows = (await this.pool.query("select id,expires_at,revoked_at,created_at from gallery_share where owner_id=$1 order by created_at desc", [ownerId])).rows;
    return rows.map((row) => this.toShare(row));
  }

  async revoke(ownerId: string, id: string) {
    return (await this.pool.query("update gallery_share set revoked_at=coalesce(revoked_at,now()) where owner_id=$1 and id=$2::uuid returning id", [ownerId, id])).rowCount === 1;
  }

  // This check intentionally runs for every public metadata and image request.
  async publicOwner(token: string): Promise<string | null> {
    const row = (await this.pool.query(
      `select s.owner_id from gallery_share s join pilot_account a on a.owner_id=s.owner_id
       where s.token_hash=$1 and s.revoked_at is null and (s.expires_at is null or s.expires_at>now()) and a.state='ACTIVE' limit 1`,
      [tokenHash(token)],
    )).rows[0];
    return row ? String(row.owner_id) : null;
  }

  async publicGallery(token: string): Promise<PublicGallery | null> {
    const ownerId = await this.publicOwner(token);
    if (!ownerId) return null;
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
    return { alters, generalImages: generalRows.map((row, order) => ({ id: String(row.id), contentType: String(row.content_type), role: "image", order })) };
  }

  async publicImage(token: string, imageId: string) {
    const ownerId = await this.publicOwner(token);
    if (!ownerId) return null;
    const row = (await this.pool.query("select storage_key,content_type from private_image where owner_id=$1 and id=$2::uuid limit 1", [ownerId, imageId])).rows[0];
    return row ? { storageKey: String(row.storage_key), contentType: String(row.content_type) } : null;
  }

  private toShare(row: Record<string, unknown>): GalleryShare {
    return { id: String(row.id), expiresAt: row.expires_at ? date(row.expires_at) : null, revokedAt: row.revoked_at ? date(row.revoked_at) : null, createdAt: date(row.created_at) };
  }
}

let singleton: GalleryShareService | undefined;
export function getGalleryShareService() { return singleton ??= new GalleryShareService(); }
