import { createHash, randomBytes } from "node:crypto";
import { getDatabasePool } from "@/db/client";
import { readPrivateImage } from "@/server/private-images";

export type ReferenceImage = { id: string; storageKey: string; contentType: string; version: number; role: "profilePicture" | "appearanceReference" };
export type ReferenceProfile = {
  id: string; version: number; name: string; pronouns: string | null; species: string | null;
  visualDescription: string | null; presentation: string | null; signatureTraits: string[]; imageDoNotChange: string[];
  profilePictureId: string | null; appearanceReferenceImageId: string | null;
};
export type ReferenceCredential = { id: string; ownerId: string; label: string; selectedAlterIds: string[]; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };
export type IssuedReferenceCredential = ReferenceCredential & { secret: string };

export interface ReferenceRepository {
  create(ownerId: string, label: string, tokenHash: string, alterIds: string[]): Promise<ReferenceCredential>;
  list(ownerId: string): Promise<ReferenceCredential[]>;
  revoke(ownerId: string, credentialId: string): Promise<boolean>;
  findActiveByHash(tokenHash: string): Promise<ReferenceCredential | null>;
  profilesForSelection(ownerId: string, selectedAlterIds: string[]): Promise<ReferenceProfile[]>;
  imagesForSelection(ownerId: string, selectedAlterIds: string[]): Promise<ReferenceImage[]>;
  touch(credentialId: string): Promise<void>;
}

export class ReferenceAuthorizationError extends Error {}
export class ReferenceValidationError extends Error {}

function iso(value: unknown) { return new Date(String(value)).toISOString(); }

class PostgresReferenceRepository implements ReferenceRepository {
  private pool() { return getDatabasePool(); }

  async create(ownerId: string, label: string, tokenHash: string, alterIds: string[]) {
    const client = await this.pool().connect();
    try {
      await client.query("begin");
      const valid = await client.query<{ id: string }>("select id from alter_profile where owner_id = $1 and archived_at is null and id = any($2::uuid[])", [ownerId, alterIds]);
      if (valid.rows.length !== alterIds.length) throw new ReferenceValidationError("Every selected profile must belong to this account and be active.");
      const inserted = await client.query<{ id: string; created_at: Date }>("insert into reference_credential (owner_id, token_hash, label) values ($1, $2, $3) returning id, created_at", [ownerId, tokenHash, label]);
      const id = inserted.rows[0].id;
      for (const alterId of alterIds) await client.query("insert into reference_credential_alter (credential_id, owner_id, alter_id) values ($1, $2, $3)", [id, ownerId, alterId]);
      await client.query("commit");
      return { id, ownerId, label, selectedAlterIds: [...alterIds].sort(), createdAt: iso(inserted.rows[0].created_at), revokedAt: null, lastUsedAt: null };
    } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
  }

  async list(ownerId: string) {
    const result = await this.pool().query("select c.id, c.owner_id, c.label, c.created_at, c.revoked_at, c.last_used_at, coalesce(array_agg(a.alter_id order by a.alter_id) filter (where a.alter_id is not null), '{}') as alter_ids from reference_credential c left join reference_credential_alter a on a.credential_id = c.id where c.owner_id = $1 group by c.id order by c.created_at desc", [ownerId]);
    return result.rows.map((row) => ({ id: String(row.id), ownerId: String(row.owner_id), label: String(row.label), selectedAlterIds: (row.alter_ids as string[]).map(String), createdAt: iso(row.created_at), revokedAt: row.revoked_at ? iso(row.revoked_at) : null, lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null }));
  }

  async revoke(ownerId: string, credentialId: string) {
    const result = await this.pool().query("update reference_credential set revoked_at = coalesce(revoked_at, now()) where id = $1::uuid and owner_id = $2 returning id", [credentialId, ownerId]);
    return result.rowCount === 1;
  }

  async findActiveByHash(tokenHash: string) {
    const result = await this.pool().query("select c.id, c.owner_id, c.label, c.created_at, c.revoked_at, c.last_used_at, coalesce(array_agg(a.alter_id order by a.alter_id) filter (where a.alter_id is not null), '{}') as alter_ids from reference_credential c left join reference_credential_alter a on a.credential_id = c.id where c.token_hash = $1 and c.revoked_at is null group by c.id", [tokenHash]);
    const row = result.rows[0];
    return row ? { id: String(row.id), ownerId: String(row.owner_id), label: String(row.label), selectedAlterIds: (row.alter_ids as string[]).map(String), createdAt: iso(row.created_at), revokedAt: null, lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null } : null;
  }

  async profilesForSelection(ownerId: string, selectedAlterIds: string[]) {
    const result = await this.pool().query("select a.id, a.version, a.name, a.pronouns, a.species, a.visual_description, a.presentation, a.signature_traits, a.image_do_not_change, a.appearance_reference_image_id, (select i.id from private_image i where i.owner_id = a.owner_id and i.alter_id = a.id and i.is_profile_picture = true) as profile_picture_id from alter_profile a where a.owner_id = $1 and a.archived_at is null and a.id = any($2::uuid[]) order by a.id", [ownerId, selectedAlterIds]);
    return result.rows.map((row) => ({ id: String(row.id), version: Number(row.version), name: String(row.name), pronouns: row.pronouns, species: row.species, visualDescription: row.visual_description, presentation: row.presentation, signatureTraits: row.signature_traits ?? [], imageDoNotChange: row.image_do_not_change ?? [], profilePictureId: row.profile_picture_id ? String(row.profile_picture_id) : null, appearanceReferenceImageId: row.appearance_reference_image_id ? String(row.appearance_reference_image_id) : null }));
  }

  async imagesForSelection(ownerId: string, selectedAlterIds: string[]) {
    // Only profile pictures and explicitly selected appearance references are exportable.
    const result = await this.pool().query("select i.id, i.storage_key, i.content_type, i.reference_version, case when i.is_profile_picture then 'profilePicture' else 'appearanceReference' end as role from private_image i join alter_profile a on a.id = i.alter_id and a.owner_id = i.owner_id where i.owner_id = $1 and i.alter_id = any($2::uuid[]) and (i.is_profile_picture = true or i.id = a.appearance_reference_image_id) order by i.id", [ownerId, selectedAlterIds]);
    return result.rows.map((row) => ({ id: String(row.id), storageKey: String(row.storage_key), contentType: String(row.content_type), version: Number(row.reference_version), role: row.role as ReferenceImage["role"] }));
  }

  async touch(credentialId: string) { await this.pool().query("update reference_credential set last_used_at = now() where id = $1::uuid and revoked_at is null", [credentialId]); }
}

export function sha256(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
export function issueReferenceSecret() { return randomBytes(32).toString("base64url"); }

export class ReferenceApiService {
  constructor(private readonly repository: ReferenceRepository, private readonly imageReader: (key: string) => Promise<{ body: BodyInit; contentType: string }> = readPrivateImage) {}

  async issue(ownerId: string, input: { label: string; selectedAlterIds: string[] }): Promise<IssuedReferenceCredential> {
    const label = input.label.trim();
    const selectedAlterIds = [...new Set(input.selectedAlterIds)].sort();
    if (label.length < 1 || label.length > 120) throw new ReferenceValidationError("Credential label must be 1–120 characters.");
    if (!selectedAlterIds.length) throw new ReferenceValidationError("Select at least one profile.");
    const secret = issueReferenceSecret();
    const credential = await this.repository.create(ownerId, label, sha256(secret), selectedAlterIds);
    return { ...credential, secret };
  }

  list(ownerId: string) { return this.repository.list(ownerId); }
  revoke(ownerId: string, credentialId: string) { return this.repository.revoke(ownerId, credentialId); }

  async authorize(secret: string) {
    const credential = await this.repository.findActiveByHash(sha256(secret));
    if (!credential || credential.revokedAt || !credential.selectedAlterIds.length) throw new ReferenceAuthorizationError("Reference credential is invalid or revoked.");
    const profiles = await this.repository.profilesForSelection(credential.ownerId, credential.selectedAlterIds);
    // A deselected, archived, or cross-owner profile invalidates the request rather than leaking a partial selection.
    if (profiles.length !== credential.selectedAlterIds.length) throw new ReferenceAuthorizationError("Reference credential selection is no longer available.");
    await this.repository.touch(credential.id);
    return { credential, profiles };
  }

  async manifest(secret: string) {
    const { credential, profiles } = await this.authorize(secret);
    const images = await this.repository.imagesForSelection(credential.ownerId, credential.selectedAlterIds);
    const imageManifest = await Promise.all(images.map(async (image) => {
      const stored = await this.imageReader(image.storageKey);
      const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
      return { id: image.id, version: image.version, contentType: image.contentType, sha256: sha256(bytes), role: image.role };
    }));
    const byProfile = new Map<string, ReferenceImage[]>();
    for (const image of images) {
      // Discover the owning profile from the explicitly selected image IDs below.
      // Image IDs are only connected through profile's selected/profile fields.
      for (const profile of profiles) if (profile.profilePictureId === image.id || profile.appearanceReferenceImageId === image.id) byProfile.set(profile.id, [...(byProfile.get(profile.id) ?? []), image]);
    }
    return { version: 1, credentialId: credential.id, profiles: profiles.map((profile) => ({
      id: profile.id, version: profile.version, name: profile.name, pronouns: profile.pronouns, species: profile.species,
      visualDescription: profile.visualDescription, presentation: profile.presentation, signatureTraits: profile.signatureTraits,
      imageDoNotChange: profile.imageDoNotChange,
      images: imageManifest.filter((image) => (byProfile.get(profile.id) ?? []).some((candidate) => candidate.id === image.id)),
    })) };
  }

  async image(secret: string, imageId: string) {
    const { credential } = await this.authorize(secret);
    const image = (await this.repository.imagesForSelection(credential.ownerId, credential.selectedAlterIds)).find((candidate) => candidate.id === imageId);
    if (!image) throw new ReferenceAuthorizationError("That image is not authorized by this credential.");
    const stored = await this.imageReader(image.storageKey);
    const bytes = new Uint8Array(await new Response(stored.body).arrayBuffer());
    return { bytes, contentType: image.contentType, version: image.version, sha256: sha256(bytes) };
  }
}

const postgresRepository = new PostgresReferenceRepository();
export const referenceApi = new ReferenceApiService(postgresRepository);
