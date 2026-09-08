import type { PoolClient } from "pg";
import { getDatabasePool } from "@/db/client";
import { groupPhotoPlacementInputSchema, groupPhotoProjectStatusSchema, provisionalSceneAnalysis, sceneAnalysisSchema, type GroupPhotoPlacementInput, type GroupPhotoProject, type SceneAnalysis } from "@/domain/group-photo";
import { SystemError } from "@/server/system-error";

function iso(value: unknown) { return new Date(String(value)).toISOString(); }

export class GroupPhotoService {
  private async transaction<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await getDatabasePool().connect();
    try { await client.query("begin"); const result = await run(client); await client.query("commit"); return result; }
    catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
  }

  private async ensureOwner(client: PoolClient, ownerId: string) {
    await client.query("insert into app_user (id, google_subject) values ($1, $1) on conflict (id) do nothing", [ownerId]);
  }

  private projectFromRows(project: Record<string, unknown>, placements: Array<Record<string, unknown>>): GroupPhotoProject {
    return {
      id: String(project.id), backplateContentType: String(project.backplate_content_type), sceneAnalysis: sceneAnalysisSchema.parse(project.scene_analysis),
      status: groupPhotoProjectStatusSchema.parse(project.status), version: Number(project.version), createdAt: iso(project.created_at), updatedAt: iso(project.updated_at),
      placements: placements.map((item) => ({ id: String(item.id), alterId: String(item.alter_id), tokenX: Number(item.token_x), tokenY: Number(item.token_y), depth: Number(item.depth), occupancyZoneId: item.occupancy_zone_id ? String(item.occupancy_zone_id) : null, relationHints: Array.isArray(item.relation_hints) ? item.relation_hints as GroupPhotoPlacementInput["relationHints"] : [], version: Number(item.version), createdAt: iso(item.created_at), updatedAt: iso(item.updated_at) })),
    };
  }

  private async read(client: PoolClient, ownerId: string, projectId: string) {
    const project = await client.query("select * from group_photo_project where owner_id = $1 and id = $2::uuid", [ownerId, projectId]);
    if (!project.rows[0]) throw new SystemError("NOT_FOUND", "Group Photo project not found.");
    const placements = await client.query("select * from group_photo_placement where owner_id = $1 and project_id = $2::uuid order by created_at asc", [ownerId, projectId]);
    return this.projectFromRows(project.rows[0], placements.rows);
  }

  async create(ownerId: string, input: { storageKey: string; contentType: string; analysis?: SceneAnalysis }) {
    return this.transaction(async (client) => {
      await this.ensureOwner(client, ownerId);
      const analysis = sceneAnalysisSchema.parse(input.analysis ?? provisionalSceneAnalysis());
      const created = await client.query("insert into group_photo_project (owner_id, backplate_storage_key, backplate_content_type, scene_analysis, status) values ($1, $2, $3, $4::jsonb, 'READY') returning id", [ownerId, input.storageKey, input.contentType, JSON.stringify(analysis)]);
      return this.read(client, ownerId, String(created.rows[0].id));
    });
  }

  async get(ownerId: string, projectId: string) { return this.transaction((client) => this.read(client, ownerId, projectId)); }

  async backplate(ownerId: string, projectId: string) {
    return this.transaction(async (client) => {
      const result = await client.query("select backplate_storage_key, backplate_content_type from group_photo_project where owner_id = $1 and id = $2::uuid", [ownerId, projectId]);
      if (!result.rows[0]) throw new SystemError("NOT_FOUND", "Group Photo project not found.");
      return { storageKey: String(result.rows[0].backplate_storage_key), contentType: String(result.rows[0].backplate_content_type) };
    });
  }

  async savePlacement(ownerId: string, projectId: string, raw: unknown, expectedVersion: number) {
    const input = groupPhotoPlacementInputSchema.parse(raw);
    return this.transaction(async (client) => {
      const project = await client.query("select version from group_photo_project where owner_id = $1 and id = $2::uuid for update", [ownerId, projectId]);
      if (!project.rows[0]) throw new SystemError("NOT_FOUND", "Group Photo project not found.");
      if (Number(project.rows[0].version) !== expectedVersion) throw new SystemError("CONFLICT", "This Group Photo changed since it was opened. Reload it, then try again.", { currentVersion: Number(project.rows[0].version) });
      const alter = await client.query("select 1 from alter_profile where owner_id = $1 and id = $2::uuid and archived_at is null", [ownerId, input.alterId]);
      if (!alter.rows[0]) throw new SystemError("NOT_FOUND", "That person is not available in your private lineup.");
      await client.query(`insert into group_photo_placement (project_id, owner_id, alter_id, token_x, token_y, depth, occupancy_zone_id, relation_hints)
        values ($1::uuid, $2, $3::uuid, $4, $5, $6, $7, $8::jsonb)
        on conflict (project_id, alter_id) do update set token_x = excluded.token_x, token_y = excluded.token_y, depth = excluded.depth, occupancy_zone_id = excluded.occupancy_zone_id, relation_hints = excluded.relation_hints, version = group_photo_placement.version + 1, updated_at = now()`, [projectId, ownerId, input.alterId, input.tokenX, input.tokenY, input.depth, input.occupancyZoneId ?? null, JSON.stringify(input.relationHints)]);
      await client.query("update group_photo_project set version = version + 1, updated_at = now() where id = $1::uuid", [projectId]);
      return this.read(client, ownerId, projectId);
    });
  }
}

let singleton: GroupPhotoService | undefined;
export function getGroupPhotoService() { singleton ??= new GroupPhotoService(); return singleton; }
