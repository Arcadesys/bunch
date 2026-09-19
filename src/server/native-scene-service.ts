import sharp from "sharp";
import { ImageAllowanceService } from "./image-allowance";
import { ImageRepairService } from "./image-repair";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getDatabasePool } from "@/db/client";
import {
  nativeSceneInputSchema,
  nativeSceneSizes,
  nativeSceneRenderSchema,
  type NativeSceneInput,
  type NativeSceneRender,
} from "@/domain/native-scene";
import { buildAlterImagePrompt } from "@/domain/image-prompt";
import type { AlterView } from "@/domain/contracts";
import { SystemError } from "./system-error";
import { SystemService } from "./system-service";
import {
  deletePrivateImages,
  readPrivateImage,
  savePrivateImage,
} from "./private-images";
import {
  DEFAULT_GROUP_PHOTO_MODEL,
  MAX_REFERENCE_IMAGES,
  normalizeFinishedPhoto,
  openAINativeSceneProvider,
  photoFinisherAvailable,
  type NativeSceneProvider,
} from "./group-photo-provider";

type Recipe = {
  repairSource?: NativeSceneInput["repairSource"];
  requestedFormat?: NativeSceneInput["format"];
  scene: string;
  alterNames: string[];
  prompt: string;
  format: NativeSceneInput["format"];
  profiles: { id: string; version: number }[];
  references: {
    alterId: string;
    alterName: string;
    imageId: string;
    name: string;
  }[];
};
type Dependencies = {
  provider?: NativeSceneProvider;
  available?: () => boolean;
  readImage?: typeof readPrivateImage;
  saveImage?: typeof savePrivateImage;
  removeImages?: typeof deletePrivateImages;
  dailyLimit?: number;
};
function iso(value: unknown) {
  return new Date(String(value)).toISOString();
}
function providerIdentityId(index: number) {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
}
export function nativeSceneView(
  row: Record<string, unknown>,
): NativeSceneRender {
  const recipe = row.recipe as Recipe;
  return nativeSceneRenderSchema.parse({
    id: String(row.id),
    repairSource: recipe.repairSource,
    scene: recipe.scene,
    alterNames: recipe.alterNames,
    state: row.state,
    createdAt: iso(row.created_at),
    finishedAt: row.finished_at ? iso(row.finished_at) : null,
    errorMessage: row.error_message ? String(row.error_message) : null,
    width: row.width ? Number(row.width) : null,
    height: row.height ? Number(row.height) : null,
    contentHash: row.content_hash ? String(row.content_hash) : null,
  });
}

export class NativeSceneService {
  private provider: NativeSceneProvider;
  private available: () => boolean;
  private readImage: typeof readPrivateImage;
  private saveImage: typeof savePrivateImage;
  private removeImages: typeof deletePrivateImages;
  readonly allowance: ImageAllowanceService;
  readonly repairs: ImageRepairService;
  constructor(
    readonly pool: Pool = getDatabasePool(),
    dependencies: Dependencies = {},
  ) {
    this.provider = dependencies.provider ?? openAINativeSceneProvider;
    this.available = dependencies.available ?? photoFinisherAvailable;
    this.readImage = dependencies.readImage ?? readPrivateImage;
    this.saveImage = dependencies.saveImage ?? savePrivateImage;
    this.removeImages = dependencies.removeImages ?? deletePrivateImages;
    this.allowance = new ImageAllowanceService(pool, dependencies.dailyLimit);
    this.repairs = new ImageRepairService(pool);

  }
  isAvailable() {
    return this.available();
  }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await fn(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
  private async expire(ownerId: string) {
    await this.allowance.expire(ownerId);
  }

  private async resolve(ownerId: string, names: string[]) {
    if (!names.length) return [] as AlterView[];
    const service = new SystemService(this.pool);
    const all: AlterView[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.listAlters(ownerId, {
        limit: 100,
        cursor,
        includeArchived: false,
      });
      all.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    const seen = new Set<string>();
    return names.flatMap((name) => {
      const normalized = name.trim().toLocaleLowerCase();
      const matches = all.filter(
        (profile) =>
          profile.name.trim().toLocaleLowerCase() === normalized ||
          profile.aliases.some(
            (alias) => alias.trim().toLocaleLowerCase() === normalized,
          ),
      );
      if (!matches.length)
        throw new SystemError(
          "NOT_FOUND",
          `No active private alter matches ${name}.`,
        );
      if (matches.length > 1)
        throw new SystemError(
          "VALIDATION_ERROR",
          `More than one private alter matches ${name}.`,
        );
      return seen.has(matches[0].id)
        ? []
        : (seen.add(matches[0].id), [matches[0]]);
    });
  }
  async start(ownerId: string, raw: unknown) {
    const input = nativeSceneInputSchema.parse(raw);
    await this.expire(ownerId);
    await this.allowance.assertAccess(this.pool, ownerId);
    const existing = await this.pool.query(
      "select * from native_scene_render where owner_id=$1 and request_id=$2::uuid",
      [ownerId, input.requestId],
    );
    if (existing.rows[0]) {
      const recipe = existing.rows[0].recipe as Recipe;
      if (
        recipe.scene !== input.scene ||
        JSON.stringify(recipe.alterNames) !==
          JSON.stringify(input.alterNames) ||
        (recipe.requestedFormat ?? recipe.format) !== input.format ||
        recipe.repairSource?.kind !== input.repairSource?.kind ||
        recipe.repairSource?.id !== input.repairSource?.id
      )
        throw new SystemError(
          "CONFLICT",
          "This request ID belongs to different scene input.",
        );
      return nativeSceneView(existing.rows[0]);
    }
    if (!this.available())
      throw new SystemError(
        "VALIDATION_ERROR",
        "Native scene generation is not connected yet.",
      );
    if (input.repairSource && input.alterNames.length) throw new SystemError("VALIDATION_ERROR", "Repair the selected image without adding new people.");
    const source = input.repairSource ? await this.repairs.source(this.pool, ownerId, input.repairSource) : undefined;
    const profiles = await this.resolve(ownerId, input.alterNames);
    const references = profiles.flatMap((profile, personIndex) =>
      profile.appearanceReferenceImageIds.map((imageId, referenceIndex) => {
        if (!profile.images.some((image) => image.id === imageId))
          throw new SystemError(
            "VALIDATION_ERROR",
            `A selected reference for ${profile.name} is unavailable. Select it again in People.`,
          );
        return {
          alterId: profile.id,
          alterName: profile.name,
          imageId,
          name: `reference-person-${personIndex + 1}-${referenceIndex + 1}`,
        };
      }),
    );
    if (profiles.some((profile) => !profile.appearanceReferenceImageIds.length))
      throw new SystemError(
        "VALIDATION_ERROR",
        "Every named person needs selected appearance references.",
      );
    if (references.length > MAX_REFERENCE_IMAGES)
      throw new SystemError(
        "VALIDATION_ERROR",
        `This scene supports up to ${MAX_REFERENCE_IMAGES} selected reference images.`,
      );
    const providerProfiles = profiles.map((profile, index) => ({
      ...profile,
      id: providerIdentityId(index),
    }));
    const identity = providerProfiles.length
      ? buildAlterImagePrompt(input.scene, providerProfiles)
      : null;
    if (identity && !identity.ready)
      throw new SystemError("VALIDATION_ERROR", identity.notices.join(" "));
    const prompt = identity
      ? `${identity.prompt}\n\n${references.map((reference, index) => `Image ${index + 1} is the selected appearance reference for ${reference.alterName}, person ${profiles.findIndex((profile) => profile.id === reference.alterId) + 1}.`).join("\n")}`
      : input.scene;
    let repairFormat = input.format;
    if (source) {
      const metadata = await sharp(new Uint8Array(await new Response((await this.readImage(source.storage_key)).body).arrayBuffer()), { limitInputPixels: 36_000_000 }).metadata();
      repairFormat = (metadata.width ?? 1) > (metadata.height ?? 1) ? "landscape" : (metadata.height ?? 1) > (metadata.width ?? 1) ? "portrait" : "square";
    }
    const recipe: Recipe = {
      scene: input.scene,
      alterNames: input.alterNames,
      prompt: source ? `Edit the supplied original image. Preserve its people, identities, composition and all details except the requested correction. Do not add people. Requested correction: ${input.scene}` : prompt,
      repairSource: input.repairSource,
      requestedFormat: input.format,
      format: repairFormat,
      profiles: profiles.map((profile) => ({
        id: profile.id,
        version: profile.version,
      })),
      references,
    };
    if (source) recipe.profiles = source.profiles;
    return this.transaction(async (client) => {
      await client.query(
        "insert into app_user(id,google_subject) values($1,$1) on conflict(id) do nothing",
        [ownerId],
      );
      await client.query("select id from app_user where id=$1 for update", [
        ownerId,
      ]);
      const replay = await client.query(
        "select * from native_scene_render where owner_id=$1 and request_id=$2::uuid",
        [ownerId, input.requestId],
      );
      if (replay.rows[0]) {
        const prior = replay.rows[0].recipe as Recipe;
        if (
          prior.scene !== input.scene ||
          JSON.stringify(prior.alterNames) !==
            JSON.stringify(input.alterNames) ||
          (prior.requestedFormat ?? prior.format) !== input.format ||
          prior.repairSource?.kind !== input.repairSource?.kind ||
        prior.repairSource?.id !== input.repairSource?.id
        )
          throw new SystemError(
            "CONFLICT",
            "This request ID belongs to different scene input.",
          );
        return nativeSceneView(replay.rows[0]);
      }
      if (
        (
          await client.query(
            "select 1 from native_scene_render where owner_id=$1 and state in ('QUEUED','RUNNING')",
            [ownerId],
          )
        ).rowCount ||
        (
          await client.query(
            "select 1 from group_photo_render where owner_id=$1 and state in ('QUEUED','RUNNING') and created_at >= now()-interval '6 minutes'",
            [ownerId],
          )
        ).rowCount
      )
        throw new SystemError(
          "CONFLICT",
          "An image is already generating. Wait for it before starting another.",
        );
      const model =
        process.env.NATIVE_SCENE_MODEL ||
        process.env.GROUP_PHOTO_MODEL ||
        DEFAULT_GROUP_PHOTO_MODEL;
      const inserted = await client.query(
        "insert into native_scene_render(owner_id,request_id,state,model,recipe) values($1,$2::uuid,'QUEUED',$3,$4::jsonb) returning *",
        [ownerId, input.requestId, model, JSON.stringify(recipe)],
      );
      if (input.repairSource) {
        await this.repairs.validate(client, ownerId, recipe);
        const column = { private: "source_private_id", native: "source_native_id", group: "source_group_id" }[input.repairSource.kind];
        await client.query(`update native_scene_render set ${column}=$1 where owner_id=$2 and id=$3`, [input.repairSource.id, ownerId, inserted.rows[0].id]);
      }
      await this.allowance.reserve(client, ownerId, "native", inserted.rows[0].id);
      return nativeSceneView(inserted.rows[0]);
    });
  }
  async list(ownerId: string) {
    await this.expire(ownerId);
    return (
      await this.pool.query(
        "select * from native_scene_render where owner_id=$1 order by created_at desc limit 20",
        [ownerId],
      )
    ).rows.map(nativeSceneView);
  }
  async get(ownerId: string, id: string) {
    await this.expire(ownerId);
    const row = (
      await this.pool.query(
        "select * from native_scene_render where owner_id=$1 and id=$2::uuid",
        [ownerId, id],
      )
    ).rows[0];
    if (!row) throw new SystemError("NOT_FOUND", "Native scene not found.");
    return nativeSceneView(row);
  }
  async process(ownerId: string, id: string) {
    const job = await this.allowance.claim(ownerId, "native", id);
    if (!job) return;
    let savedKey: string | undefined;
    try {
      const recipe = job.recipe as Recipe;
      const profiles = new SystemService(this.pool);
      for (const snapshot of recipe.profiles) {
        const current = await profiles.getAlter(ownerId, snapshot.id);
        if (current.version !== snapshot.version)
          throw new Error(
            "A person's appearance changed. Generate the scene again using their current references.",
          );
      }
      const images = [];
      if (recipe.repairSource) {
        const source = await this.repairs.source(this.pool, ownerId, recipe.repairSource);
        images.push({ bytes: new Uint8Array(await new Response((await this.readImage(source.storage_key)).body).arrayBuffer()), contentType: source.content_type, name: "original-image" });
      }
      for (const reference of recipe.references) {
        const row = (
          await this.pool.query(
            "select storage_key,content_type from private_image where owner_id=$1 and alter_id=$2::uuid and id=$3::uuid",
            [ownerId, reference.alterId, reference.imageId],
          )
        ).rows[0];
        if (!row)
          throw new Error(
            "A selected appearance reference is no longer available. Review People before trying again.",
          );
        images.push({
          bytes: new Uint8Array(
            await new Response(
              (await this.readImage(row.storage_key)).body,
            ).arrayBuffer(),
          ),
          contentType: row.content_type,
          name: reference.name,
        });
      }
      await this.allowance.dispatch(ownerId, "native", id, c => this.repairs.validate(c, ownerId, recipe));
      const output = await this.provider({
        prompt: recipe.prompt,
        model: job.model,
        references: images,
        size: nativeSceneSizes[recipe.format],
        onUsage: usage => this.allowance.recordUsage(ownerId, "native", id, usage),
      });
      const photo = await normalizeFinishedPhoto(output);
      const hash = createHash("sha256").update(photo.bytes).digest("hex");
      const stored = await this.saveImage(
        ownerId,
        new File([new Uint8Array(photo.bytes)], "native-scene.jpg", {
          type: photo.contentType,
        }),
      );
      savedKey = stored.storageKey;
      await this.transaction(async (client) => {
        await client.query("select id from app_user where id=$1 for update", [
          ownerId,
        ]);
        await this.allowance.assertAccess(client, ownerId);
        await this.repairs.validate(client, ownerId, recipe);
        for (const snapshot of recipe.profiles) {
          const current = (
            await client.query(
              "select version from alter_profile where owner_id=$1 and id=$2::uuid and archived_at is null for share",
              [ownerId, snapshot.id],
            )
          ).rows[0];
          if (!current || Number(current.version) !== snapshot.version)
            throw new Error(
              "A person's appearance changed. Generate the scene again using their current references.",
            );
        }
        const updated = await client.query(
          "update native_scene_render set state='COMPLETE',storage_key=$1,content_type=$2,content_hash=$3,width=$4,height=$5,finished_at=now() where owner_id=$6 and id=$7::uuid and state='RUNNING' returning id",
          [
            savedKey,
            photo.contentType,
            hash,
            photo.width,
            photo.height,
            ownerId,
            id,
          ],
        );
        if (!updated.rowCount)
          throw new Error(
            "Scene generation was interrupted. You can try again.",
          );
      });
      savedKey = undefined;
    } catch (error) {
      if (savedKey) {
        const committed = await this.pool.query(
          "select state,storage_key from native_scene_render where owner_id=$1 and id=$2::uuid",
          [ownerId, id],
        );
        if (
          committed.rows[0]?.state === "COMPLETE" &&
          committed.rows[0].storage_key === savedKey
        )
          return;
        try {
          await this.removeImages([savedKey]);
        } catch {}
      }
      const known =
        error instanceof Error &&
        /^(A person's appearance changed|A selected appearance reference|Scene generation was interrupted|Private image storage|Image access|Repair source)/.test(
          error.message,
        );
      await this.allowance.failJob(ownerId, "native", id,
        error instanceof SystemError && ["QUOTA_EXCEEDED", "FORBIDDEN", "NOT_FOUND"].includes(error.code) ? error.userMessage : known ? (error as Error).message : "The scene could not be generated and saved. Try again later.");
    }
  }
  async image(ownerId: string, id: string) {
    const row = (
      await this.pool.query(
        "select storage_key,content_type from native_scene_render where owner_id=$1 and id=$2::uuid and state='COMPLETE'",
        [ownerId, id],
      )
    ).rows[0];
    if (!row)
      throw new SystemError("NOT_FOUND", "Native scene image not found.");
    return {
      ...(await this.readImage(row.storage_key)),
      contentType: String(row.content_type),
    };
  }
}
let singleton: NativeSceneService | undefined;
export function getNativeSceneService() {
  singleton ??= new NativeSceneService();
  return singleton;
}
