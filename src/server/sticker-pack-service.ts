import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@/db/client";
import {
  saveStickerPackSchema,
  stickerPackViewSchema,
  stickerSlotsSchema,
  type SaveStickerPackInput,
  type StickerPackView,
} from "@/domain/sticker-pack";
import { SystemError } from "./system-error";

type RecordSource = "MCP" | "WEB" | "SYSTEM";

type PackRow = {
  id: string;
  alter_id: string;
  alter_name: string;
  communication_profile: string | null;
  status: "DRAFT" | "APPROVED" | "PUBLISHED";
  slots: unknown;
  telegram_url: string | null;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
};

function view(row: PackRow): StickerPackView {
  return stickerPackViewSchema.parse({
    id: row.id,
    alterId: row.alter_id,
    alterName: row.alter_name,
    communicationProfile: row.communication_profile,
    status: row.status,
    slots: stickerSlotsSchema.parse(row.slots),
    telegramUrl: row.telegram_url,
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  });
}

export class StickerPackService {
  constructor(readonly pool: Pool = getDatabasePool()) {}

  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const value = await run(client);
      await client.query("commit");
      return value;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  private async activeAlter(client: Pool | PoolClient, ownerId: string, alterId: string) {
    const row = (
      await client.query<{ id: string; name: string }>(
        "select id,name from alter_profile where owner_id=$1 and id=$2::uuid and archived_at is null",
        [ownerId, alterId],
      )
    ).rows[0];
    if (!row) throw new SystemError("NOT_FOUND", "That active person was not found.");
    return row;
  }

  private async readWith(client: Pool | PoolClient, ownerId: string, alterId: string) {
    await this.activeAlter(client, ownerId, alterId);
    const row = (
      await client.query<PackRow>(
        `select p.*,a.name as alter_name
         from alter_sticker_pack p
         join alter_profile a on a.owner_id=p.owner_id and a.id=p.alter_id
         where p.owner_id=$1 and p.alter_id=$2::uuid and a.archived_at is null`,
        [ownerId, alterId],
      )
    ).rows[0];
    return row ? view(row) : null;
  }

  async get(ownerId: string, alterId: string) {
    return this.readWith(this.pool, ownerId, alterId);
  }

  async list(ownerId: string) {
    const rows = await this.pool.query<PackRow>(
      `select p.*,a.name as alter_name
       from alter_sticker_pack p
       join alter_profile a on a.owner_id=p.owner_id and a.id=p.alter_id
       where p.owner_id=$1 and a.archived_at is null
       order by p.updated_at desc,p.id`,
      [ownerId],
    );
    return rows.rows.map(view);
  }

  async save(ownerId: string, alterId: string, raw: SaveStickerPackInput, source: RecordSource) {
    const input = saveStickerPackSchema.parse(raw);
    if (input.status !== "DRAFT" && input.slots.some((slot) => !slot.performance.trim()))
      throw new SystemError("VALIDATION_ERROR", "Every approved sticker needs a performance.");
    if (input.status === "PUBLISHED" && !input.telegramUrl)
      throw new SystemError("VALIDATION_ERROR", "A published sticker pack needs its Telegram add-pack URL.");
    if (input.status !== "PUBLISHED" && input.telegramUrl)
      throw new SystemError("VALIDATION_ERROR", "Save the Telegram URL only when marking the pack published.");

    const operation = `save_sticker_pack:${alterId}`;
    return this.transaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`${ownerId}:${input.requestId}`]);
      const prior = (
        await client.query<{ operation: string; result: StickerPackView }>(
          "select operation,result from mutation_receipt where owner_id=$1 and request_id=$2::uuid",
          [ownerId, input.requestId],
        )
      ).rows[0];
      if (prior) {
        if (prior.operation !== operation)
          throw new SystemError("CONFLICT", "This request ID belongs to a different change.");
        return { data: stickerPackViewSchema.parse(prior.result), replayed: true };
      }

      await this.activeAlter(client, ownerId, alterId);
      const current = (
        await client.query<{ id: string; version: number; status: string }>(
          "select id,version,status from alter_sticker_pack where owner_id=$1 and alter_id=$2::uuid for update",
          [ownerId, alterId],
        )
      ).rows[0];

      if (current) {
        if (input.expectedVersion !== Number(current.version))
          throw new SystemError("CONFLICT", "This sticker pack changed. Reload it before saving.");
      } else if (input.expectedVersion !== null) {
        throw new SystemError("CONFLICT", "This sticker pack does not exist yet. Reload before saving.");
      }

      if (current) {
        await client.query(
          `update alter_sticker_pack
           set communication_profile=$3,status=$4,slots=$5::jsonb,telegram_url=$6,
               version=version+1,updated_at=now()
           where owner_id=$1 and alter_id=$2::uuid`,
          [ownerId, alterId, input.communicationProfile, input.status, JSON.stringify(input.slots), input.telegramUrl],
        );
      } else {
        await client.query(
          `insert into alter_sticker_pack(owner_id,alter_id,communication_profile,status,slots,telegram_url)
           values($1,$2::uuid,$3,$4,$5::jsonb,$6)`,
          [ownerId, alterId, input.communicationProfile, input.status, JSON.stringify(input.slots), input.telegramUrl],
        );
      }

      const data = await this.readWith(client, ownerId, alterId);
      if (!data) throw new Error("Sticker pack disappeared after save.");

      await client.query(
        `insert into activity_event
         (owner_id,entity_type,entity_id,action,source,changed_fields,request_id,from_status,to_status)
         values($1,'STICKER_PACK',$2::uuid,$3,$4::record_source,$5::text[],$6::uuid,$7,$8)`,
        [
          ownerId,
          data.id,
          current ? "UPDATED" : "CREATED",
          source,
          ["communicationProfile", "slots", "status", "telegramUrl"],
          input.requestId,
          current?.status ?? null,
          data.status,
        ],
      );
      await client.query(
        "insert into mutation_receipt(owner_id,request_id,operation,result) values($1,$2::uuid,$3,$4::jsonb)",
        [ownerId, input.requestId, operation, JSON.stringify(data)],
      );
      return { data, replayed: false };
    });
  }
}

export const getStickerPackService = () => new StickerPackService();
