import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import sharp from "sharp";
import { getDatabasePool } from "@/db/client";
import { compositionGuidance, type GroupPhotoRender } from "@/domain/group-photo";
import { buildAlterImagePrompt } from "@/domain/image-prompt";
import { GroupPhotoService } from "./group-photo-service";
import { SystemService } from "./system-service";
import { SystemError } from "./system-error";
import { deletePrivateImages, readPrivateImage, savePrivateImage } from "./private-images";
import { DEFAULT_GROUP_PHOTO_MODEL, MAX_REFERENCE_IMAGES, normalizeFinishedPhoto, openAIGroupPhotoProvider, photoFinisherAvailable, type GroupPhotoProvider } from "./group-photo-provider";

type Recipe = { prompt: string; references: { imageId: string; alterId: string; name: string }[]; profiles: { id: string; version: number }[] };
type Dependencies = {
  provider?: GroupPhotoProvider; available?: () => boolean;
  readImage?: typeof readPrivateImage; saveImage?: typeof savePrivateImage; removeImages?: typeof deletePrivateImages;
};
export function renderView(row: Record<string, unknown>): GroupPhotoRender {
  return { id: String(row.id), sourceVersion: Number(row.source_version), state: row.state as GroupPhotoRender["state"], createdAt: new Date(String(row.created_at)).toISOString(), finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null, errorMessage: row.error_message ? String(row.error_message) : null, width: row.width ? Number(row.width) : null, height: row.height ? Number(row.height) : null, contentHash: row.content_hash ? String(row.content_hash) : null };
}
export class GroupPhotoRenderService {
  private provider: GroupPhotoProvider;
  private available: () => boolean;
  private readImage: typeof readPrivateImage;
  private saveImage: typeof savePrivateImage;
  private removeImages: typeof deletePrivateImages;
  constructor(readonly pool: Pool = getDatabasePool(), dependencies: Dependencies = {}) {
    this.provider = dependencies.provider ?? openAIGroupPhotoProvider;
    this.available = dependencies.available ?? photoFinisherAvailable;
    this.readImage = dependencies.readImage ?? readPrivateImage;
    this.saveImage = dependencies.saveImage ?? savePrivateImage;
    this.removeImages = dependencies.removeImages ?? deletePrivateImages;
  }
  private async transaction<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try { await c.query("begin"); const result = await fn(c); await c.query("commit"); return result; }
    catch (error) { await c.query("rollback"); throw error; } finally { c.release(); }
  }
  private async expire(ownerId: string) {
    // Never retry an uncertain provider call automatically: it may already be billable.
    await this.pool.query("update group_photo_render set state='FAILED', error_message='Photo finishing was interrupted. Your scene is saved. You can try again.', finished_at=now() where owner_id=$1 and state in ('QUEUED','RUNNING') and created_at < now()-interval '6 minutes'", [ownerId]);
  }
  async list(ownerId: string, projectId: string) {
    await this.expire(ownerId);
    const rows = await this.pool.query("select * from group_photo_render where owner_id=$1 and project_id=$2::uuid order by created_at desc limit 20", [ownerId, projectId]);
    return rows.rows.map(renderView);
  }
  async start(ownerId: string, projectId: string, expectedVersion: number, requestId: string) {
    await this.expire(ownerId);
    const existing = await this.pool.query("select * from group_photo_render where owner_id=$1 and request_id=$2::uuid", [ownerId, requestId]);
    if (existing.rows[0]) {
      if (existing.rows[0].project_id !== projectId || Number(existing.rows[0].source_version) !== expectedVersion) throw new SystemError("CONFLICT", "This finish request belongs to another scene version.");
      return renderView(existing.rows[0]);
    }
    if (!this.available()) throw new SystemError("VALIDATION_ERROR", "Photo finishing is not connected yet. Your scene is saved.");
    const project = await new GroupPhotoService(this.pool).get(ownerId, projectId);
    if (!project.placements.length) throw new SystemError("VALIDATION_ERROR", "Place at least one person before finishing the photo.");
    const service = new SystemService(this.pool);
    const profiles = await Promise.all(project.placements.map(p => service.getAlter(ownerId, p.alterId)));
    const missing = profiles.filter(p => !p.appearanceReferenceImageIds?.length);
    if (missing.length) throw new SystemError("VALIDATION_ERROR", `Select an appearance reference in People for: ${missing.map(p => p.name).join(", ")}.`);
    const references = profiles.flatMap(p => p.appearanceReferenceImageIds.map((id, index) => {
      if (!p.images.some(image => image.id === id)) throw new SystemError("VALIDATION_ERROR", `A selected reference for ${p.name} is unavailable. Select it again in People.`);
      return { imageId: id, alterId: p.id, name: `reference-${p.id}-${index + 1}` };
    }));
    if (references.length > MAX_REFERENCE_IMAGES) throw new SystemError("VALIDATION_ERROR", `This photo supports up to ${MAX_REFERENCE_IMAGES} selected reference images. Use a smaller group or fewer selected references.`);
    const identity = buildAlterImagePrompt(compositionGuidance(project.placements), profiles);
    if (!identity.ready) throw new SystemError("VALIDATION_ERROR", identity.notices.join(" "));
    const recipe: Recipe = { prompt: `${identity.prompt}\n\nImage 1 is the background scene. Preserve its setting and camera.\n${references.map((r, index) => `Image ${index + 2} is the selected appearance reference for person ${r.alterId}.`).join("\n")}\nUse exactly the listed people. Render one finished group photo, with natural interactions within the token clusters.`, references, profiles: profiles.map(p => ({ id: p.id, version: p.version })) };
    return this.transaction(async c => {
      // Serialize requests per owner, including two projects finished at the same time.
      await c.query("select id from app_user where id=$1 for update", [ownerId]);
      const replay = await c.query("select * from group_photo_render where owner_id=$1 and request_id=$2::uuid", [ownerId, requestId]);
      if (replay.rows[0]) {
        if (replay.rows[0].project_id !== projectId || Number(replay.rows[0].source_version) !== expectedVersion) throw new SystemError("CONFLICT", "This finish request belongs to another scene version.");
        return renderView(replay.rows[0]);
      }
      const locked = await c.query("select version from group_photo_project where owner_id=$1 and id=$2::uuid for update", [ownerId, projectId]);
      if (!locked.rows[0]) throw new SystemError("NOT_FOUND", "Scene not found.");
      if (Number(locked.rows[0].version) !== expectedVersion || project.version !== expectedVersion) throw new SystemError("CONFLICT", "Your scene changed. Reload it before finishing.");
      if ((await c.query("select 1 from group_photo_render where owner_id=$1 and state in ('QUEUED','RUNNING')", [ownerId])).rowCount) throw new SystemError("CONFLICT", "A photo is already finishing. Wait for it before starting another.");
      const result = await c.query("insert into group_photo_render(owner_id,project_id,request_id,source_version,model,recipe) values($1,$2::uuid,$3::uuid,$4,$5,$6::jsonb) returning *", [ownerId, projectId, requestId, expectedVersion, process.env.GROUP_PHOTO_MODEL || DEFAULT_GROUP_PHOTO_MODEL, JSON.stringify(recipe)]);
      return renderView(result.rows[0]);
    });
  }
  async process(ownerId: string, renderId: string) {
    const claimed = await this.pool.query("update group_photo_render set state='RUNNING',started_at=now() where id=$1::uuid and owner_id=$2 and state='QUEUED' returning *", [renderId, ownerId]);
    const job = claimed.rows[0];
    if (!job) return;
    let savedKey: string | undefined;
    try {
      const recipe = job.recipe as Recipe;
      const profileReader = new SystemService(this.pool);
      for (const profile of recipe.profiles) {
        const current = await profileReader.getAlter(ownerId, profile.id);
        if (current.version !== profile.version) throw new Error("A person's appearance changed. Finish the scene again using their current references.");
      }
      const background = await new GroupPhotoService(this.pool).backplate(ownerId, job.project_id);
      const backgroundBytes = new Uint8Array(await new Response((await this.readImage(background.storageKey)).body).arrayBuffer());
      const metadata = await sharp(backgroundBytes, { limitInputPixels: 36_000_000 }).metadata();
      const images = [{ bytes: backgroundBytes, contentType: background.contentType, name: "scene" }];
      for (const reference of recipe.references) {
        const row = (await this.pool.query("select storage_key,content_type from private_image where owner_id=$1 and alter_id=$2::uuid and id=$3::uuid", [ownerId, reference.alterId, reference.imageId])).rows[0];
        if (!row) throw new Error("A selected appearance reference is no longer available. Review People before trying again.");
        images.push({ bytes: new Uint8Array(await new Response((await this.readImage(row.storage_key)).body).arrayBuffer()), contentType: row.content_type, name: reference.name });
      }
      const size = (metadata.width ?? 1) > (metadata.height ?? 1) * 1.2 ? "1536x1024" : (metadata.height ?? 1) > (metadata.width ?? 1) * 1.2 ? "1024x1536" : "1024x1024";
      const output = await this.provider({ prompt: recipe.prompt, model: job.model, images, size });
      const photo = await normalizeFinishedPhoto(output);
      const hash = createHash("sha256").update(photo.bytes).digest("hex");
      const stored = await this.saveImage(ownerId, new File([new Uint8Array(photo.bytes)], "group-photo.jpg", { type: photo.contentType }));
      savedKey = stored.storageKey;
      await this.transaction(async c => {
        // Serialize attachment with erasure; never recreate someone's photo after erasure.
        await c.query("select id from app_user where id=$1 for update", [ownerId]);
        for (const profile of recipe.profiles) {
          const current = (await c.query("select version from alter_profile where owner_id=$1 and id=$2::uuid and archived_at is null for share", [ownerId, profile.id])).rows[0];
          if (!current || Number(current.version) !== profile.version) throw new Error("A person's appearance changed. Finish the scene again using their current references.");
        }
        const updated = await c.query("update group_photo_render set state='COMPLETE',storage_key=$1,content_type=$2,content_hash=$3,width=$4,height=$5,finished_at=now() where id=$6::uuid and owner_id=$7 and state='RUNNING' returning id", [savedKey, photo.contentType, hash, photo.width, photo.height, renderId, ownerId]);
        if (!updated.rowCount) throw new Error("Photo finishing was interrupted. Your scene is saved.");
      });
      savedKey = undefined;
    } catch (error) {
      if (savedKey) {
        // A connection can fail after commit. Confirm attachment before deleting a blob.
        const committed = await this.pool.query("select state,storage_key from group_photo_render where owner_id=$1 and id=$2::uuid", [ownerId, renderId]);
        if (committed.rows[0]?.state === "COMPLETE" && committed.rows[0].storage_key === savedKey) return;
        try { await this.removeImages([savedKey]); } catch { /* Upload reservation remains available for account cleanup. */ }
      }
      // Never return arbitrary provider/storage error strings, which can contain request data.
      const known = error instanceof Error && /^(A person's appearance changed|A selected appearance reference|Photo finishing was interrupted)/.test(error.message);
      const message = known ? (error as Error).message : "The photo could not be finished and saved. Your scene is safe. Try again later.";
      await this.pool.query("update group_photo_render set state='FAILED',error_message=$1,finished_at=now() where id=$2::uuid and owner_id=$3 and state='RUNNING'", [message, renderId, ownerId]);
    }
  }
  async image(ownerId: string, projectId: string, renderId: string) {
    const row = (await this.pool.query("select storage_key,content_type from group_photo_render where owner_id=$1 and project_id=$2::uuid and id=$3::uuid and state='COMPLETE'", [ownerId, projectId, renderId])).rows[0];
    if (!row) throw new SystemError("NOT_FOUND", "Finished photo not found.");
    return { ...await this.readImage(row.storage_key), contentType: String(row.content_type) };
  }
}
export function getGroupPhotoRenderService() { return new GroupPhotoRenderService(); }
