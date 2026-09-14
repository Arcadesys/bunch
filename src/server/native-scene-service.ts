import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getDatabasePool } from "@/db/client";
import { nativeSceneInputSchema, nativeSceneSizes, nativeSceneRenderSchema, type NativeSceneInput, type NativeSceneRender } from "@/domain/native-scene";
import { buildAlterImagePrompt } from "@/domain/image-prompt";
import type { AlterView } from "@/domain/contracts";
import { SystemError } from "./system-error";
import { SystemService } from "./system-service";
import { deletePrivateImages, readPrivateImage, savePrivateImage } from "./private-images";
import { DEFAULT_GROUP_PHOTO_MODEL, MAX_REFERENCE_IMAGES, normalizeFinishedPhoto, openAINativeSceneProvider, photoFinisherAvailable, type NativeSceneProvider } from "./group-photo-provider";

type Recipe = { scene: string; alterNames: string[]; prompt: string; format: NativeSceneInput["format"]; profiles: { id: string; version: number }[]; references: { alterId: string; imageId: string; name: string }[] };
type Dependencies = { provider?: NativeSceneProvider; available?: () => boolean; readImage?: typeof readPrivateImage; saveImage?: typeof savePrivateImage; removeImages?: typeof deletePrivateImages; dailyLimit?: number };
function iso(value: unknown) { return new Date(String(value)).toISOString(); }
export function nativeSceneView(row: Record<string, unknown>): NativeSceneRender {
  const recipe = row.recipe as Recipe;
  return nativeSceneRenderSchema.parse({ id: String(row.id), scene: recipe.scene, alterNames: recipe.alterNames, state: row.state, createdAt: iso(row.created_at), finishedAt: row.finished_at ? iso(row.finished_at) : null, errorMessage: row.error_message ? String(row.error_message) : null, width: row.width ? Number(row.width) : null, height: row.height ? Number(row.height) : null, contentHash: row.content_hash ? String(row.content_hash) : null });
}

export class NativeSceneService {
  private provider: NativeSceneProvider; private available: () => boolean; private readImage: typeof readPrivateImage; private saveImage: typeof savePrivateImage; private removeImages: typeof deletePrivateImages; private dailyLimit: number;
  constructor(readonly pool: Pool = getDatabasePool(), dependencies: Dependencies = {}) {
    this.provider = dependencies.provider ?? openAINativeSceneProvider;
    this.available = dependencies.available ?? photoFinisherAvailable;
    this.readImage = dependencies.readImage ?? readPrivateImage;
    this.saveImage = dependencies.saveImage ?? savePrivateImage;
    this.removeImages = dependencies.removeImages ?? deletePrivateImages;
    const configuredLimit = dependencies.dailyLimit ?? Number(process.env.NATIVE_SCENE_DAILY_LIMIT ?? 20);
    this.dailyLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 && configuredLimit <= 1000 ? configuredLimit : 20;
  }
  isAvailable() { return this.available(); }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>) { const client = await this.pool.connect(); try { await client.query("begin"); const result = await fn(client); await client.query("commit"); return result; } catch (error) { await client.query("rollback"); throw error; } finally { client.release(); } }
  private async expire(ownerId: string) { await this.pool.query("update native_scene_render set state='FAILED', error_message='Scene generation was interrupted. You can try again.', finished_at=now() where owner_id=$1 and state in ('QUEUED','RUNNING') and created_at < now()-interval '6 minutes'", [ownerId]); }
  private async resolve(ownerId: string, names: string[]) {
    if (!names.length) return [] as AlterView[];
    const service = new SystemService(this.pool); const all: AlterView[] = []; let cursor: string | undefined;
    do { const page = await service.listAlters(ownerId, { limit: 100, cursor, includeArchived: false }); all.push(...page.data); cursor = page.nextCursor; } while (cursor);
    const seen = new Set<string>();
    return names.flatMap(name => { const normalized = name.trim().toLocaleLowerCase(); const matches = all.filter(profile => profile.name.trim().toLocaleLowerCase() === normalized || profile.aliases.some(alias => alias.trim().toLocaleLowerCase() === normalized)); if (!matches.length) throw new SystemError("NOT_FOUND", `No active private alter matches ${name}.`); if (matches.length > 1) throw new SystemError("VALIDATION_ERROR", `More than one private alter matches ${name}.`); return seen.has(matches[0].id) ? [] : (seen.add(matches[0].id), [matches[0]]); });
  }
  async start(ownerId: string, raw: unknown) {
    const input = nativeSceneInputSchema.parse(raw); await this.expire(ownerId);
    const existing = await this.pool.query("select * from native_scene_render where owner_id=$1 and request_id=$2::uuid", [ownerId, input.requestId]);
    if (existing.rows[0]) { const recipe = existing.rows[0].recipe as Recipe; if (recipe.scene !== input.scene || JSON.stringify(recipe.alterNames) !== JSON.stringify(input.alterNames) || recipe.format !== input.format) throw new SystemError("CONFLICT", "This request ID belongs to different scene input."); return nativeSceneView(existing.rows[0]); }
    if (!this.available()) throw new SystemError("VALIDATION_ERROR", "Native scene generation is not connected yet.");
    const profiles = await this.resolve(ownerId, input.alterNames);
    const references = profiles.flatMap(profile => profile.appearanceReferenceImageIds.map((imageId, index) => { if (!profile.images.some(image => image.id === imageId)) throw new SystemError("VALIDATION_ERROR", `A selected reference for ${profile.name} is unavailable. Select it again in People.`); return { alterId: profile.id, imageId, name: `reference-${profile.id}-${index + 1}` }; }));
    if (profiles.some(profile => !profile.appearanceReferenceImageIds.length)) throw new SystemError("VALIDATION_ERROR", "Every named person needs selected appearance references.");
    if (references.length > MAX_REFERENCE_IMAGES) throw new SystemError("VALIDATION_ERROR", `This scene supports up to ${MAX_REFERENCE_IMAGES} selected reference images.`);
    const identity = profiles.length ? buildAlterImagePrompt(input.scene, profiles) : null;
    if (identity && !identity.ready) throw new SystemError("VALIDATION_ERROR", identity.notices.join(" "));
    const prompt = identity ? `${identity.prompt}\n\n${references.map((reference, index) => `Image ${index + 1} is the selected appearance reference for ${reference.alterId}.`).join("\n")}` : input.scene;
    const recipe: Recipe = { scene: input.scene, alterNames: input.alterNames, prompt, format: input.format, profiles: profiles.map(profile => ({ id: profile.id, version: profile.version })), references };
    return this.transaction(async client => {
      await client.query("insert into app_user(id,google_subject) values($1,$1) on conflict(id) do nothing", [ownerId]);
      await client.query("select id from app_user where id=$1 for update", [ownerId]);
      const replay = await client.query("select * from native_scene_render where owner_id=$1 and request_id=$2::uuid", [ownerId, input.requestId]);
      if (replay.rows[0]) {
        const prior = replay.rows[0].recipe as Recipe;
        if (prior.scene !== input.scene || JSON.stringify(prior.alterNames) !== JSON.stringify(input.alterNames) || prior.format !== input.format) throw new SystemError("CONFLICT", "This request ID belongs to different scene input.");
        return nativeSceneView(replay.rows[0]);
      }
      const quota = await client.query("select count(*)::int as count from native_scene_render where owner_id=$1 and created_at >= date_trunc('day',now())", [ownerId]);
      if (Number(quota.rows[0].count) >= this.dailyLimit) throw new SystemError("QUOTA_EXCEEDED", "The daily native-scene limit has been reached.");
      if ((await client.query("select 1 from native_scene_render where owner_id=$1 and state in ('QUEUED','RUNNING')", [ownerId])).rowCount || (await client.query("select 1 from group_photo_render where owner_id=$1 and state in ('QUEUED','RUNNING')", [ownerId])).rowCount) throw new SystemError("CONFLICT", "An image is already generating. Wait for it before starting another.");
      const model = process.env.NATIVE_SCENE_MODEL || process.env.GROUP_PHOTO_MODEL || DEFAULT_GROUP_PHOTO_MODEL;
      const inserted = await client.query("insert into native_scene_render(owner_id,request_id,state,model,recipe) values($1,$2::uuid,'QUEUED',$3,$4::jsonb) returning *", [ownerId, input.requestId, model, JSON.stringify(recipe)]);
      return nativeSceneView(inserted.rows[0]);
    });
  }
  async list(ownerId: string) { await this.expire(ownerId); return (await this.pool.query("select * from native_scene_render where owner_id=$1 order by created_at desc limit 20", [ownerId])).rows.map(nativeSceneView); }
  async get(ownerId: string, id: string) { await this.expire(ownerId); const row = (await this.pool.query("select * from native_scene_render where owner_id=$1 and id=$2::uuid", [ownerId, id])).rows[0]; if (!row) throw new SystemError("NOT_FOUND", "Native scene not found."); return nativeSceneView(row); }
  async process(ownerId: string, id: string) { const job = (await this.pool.query("update native_scene_render set state='RUNNING',started_at=now() where owner_id=$1 and id=$2::uuid and state='QUEUED' returning *", [ownerId, id])).rows[0]; if (!job) return; let savedKey: string | undefined; try { const recipe = job.recipe as Recipe; const profiles = new SystemService(this.pool); for (const snapshot of recipe.profiles) { const current = await profiles.getAlter(ownerId, snapshot.id); if (current.version !== snapshot.version) throw new Error("A person's appearance changed. Generate the scene again using their current references."); } const images = []; for (const reference of recipe.references) { const row = (await this.pool.query("select storage_key,content_type from private_image where owner_id=$1 and alter_id=$2::uuid and id=$3::uuid", [ownerId, reference.alterId, reference.imageId])).rows[0]; if (!row) throw new Error("A selected appearance reference is no longer available. Review People before trying again."); images.push({ bytes: new Uint8Array(await new Response((await this.readImage(row.storage_key)).body).arrayBuffer()), contentType: row.content_type, name: reference.name }); } const output = await this.provider({ prompt: recipe.prompt, model: job.model, references: images, size: nativeSceneSizes[recipe.format] }); const photo = await normalizeFinishedPhoto(output); const hash = createHash("sha256").update(photo.bytes).digest("hex"); const stored = await this.saveImage(ownerId, new File([new Uint8Array(photo.bytes)], "native-scene.jpg", { type: photo.contentType })); savedKey = stored.storageKey; await this.transaction(async client => { await client.query("select id from app_user where id=$1 for update", [ownerId]); for (const snapshot of recipe.profiles) { const current = (await client.query("select version from alter_profile where owner_id=$1 and id=$2::uuid and archived_at is null for share", [ownerId, snapshot.id])).rows[0]; if (!current || Number(current.version) !== snapshot.version) throw new Error("A person's appearance changed. Generate the scene again using their current references."); } const updated = await client.query("update native_scene_render set state='COMPLETE',storage_key=$1,content_type=$2,content_hash=$3,width=$4,height=$5,finished_at=now() where owner_id=$6 and id=$7::uuid and state='RUNNING' returning id", [savedKey, photo.contentType, hash, photo.width, photo.height, ownerId, id]); if (!updated.rowCount) throw new Error("Scene generation was interrupted. You can try again."); }); savedKey = undefined; } catch (error) { if (savedKey) { const committed = await this.pool.query("select state,storage_key from native_scene_render where owner_id=$1 and id=$2::uuid", [ownerId, id]); if (committed.rows[0]?.state === "COMPLETE" && committed.rows[0].storage_key === savedKey) return; try { await this.removeImages([savedKey]); } catch {} } const known = error instanceof Error && /^(A person's appearance changed|A selected appearance reference|Scene generation was interrupted)/.test(error.message); await this.pool.query("update native_scene_render set state='FAILED',error_message=$1,finished_at=now() where owner_id=$2 and id=$3::uuid and state='RUNNING'", [known ? (error as Error).message : "The scene could not be generated and saved. Try again later.", ownerId, id]); } }
  async image(ownerId: string, id: string) { const row = (await this.pool.query("select storage_key,content_type from native_scene_render where owner_id=$1 and id=$2::uuid and state='COMPLETE'", [ownerId, id])).rows[0]; if (!row) throw new SystemError("NOT_FOUND", "Native scene image not found."); return { ...await this.readImage(row.storage_key), contentType: String(row.content_type) }; }
}
let singleton: NativeSceneService | undefined;
export function getNativeSceneService() { singleton ??= new NativeSceneService(); return singleton; }
