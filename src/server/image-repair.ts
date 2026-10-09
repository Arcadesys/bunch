import type { Pool, PoolClient } from "pg";
import type { RepairSource } from "@/domain/native-scene";
import { SystemError } from "./system-error";
type Db = Pick<Pool, "query"> | PoolClient;
type Profile = { id: string; version: number };
type Recipe = { repairSource?: RepairSource; profiles: Profile[]; references?: { imageId: string; alterId: string }[] };
export class ImageRepairService {
  constructor(readonly pool: Pool) {}
  async source(db: Db, owner: string, source: RepairSource): Promise<{ storage_key: string; content_type: string; profiles: Profile[] }> {
    if (source.kind === "private") {
      const r = (await db.query("select i.storage_key,i.content_type,p.id,p.version from private_image i join alter_profile p on p.id=i.alter_id and p.owner_id=i.owner_id where i.owner_id=$1 and i.id=$2 and p.archived_at is null", [owner, source.id])).rows[0];
      if (!r) throw new SystemError("NOT_FOUND", "Repair source is no longer available.");
      return { ...r, profiles: [{ id: r.id, version: Number(r.version) }] };
    }
    const table = source.kind === "native" ? "native_scene_render" : "group_photo_render";
    const r = (await db.query(`select storage_key,content_type,recipe from ${table} where owner_id=$1 and id=$2 and state='COMPLETE'`, [owner, source.id])).rows[0];
    if (!r) throw new SystemError("NOT_FOUND", "Repair source is no longer available.");
    const inherited = (r.recipe.profiles ?? []) as Profile[];
    const profiles: Profile[] = [];
    // Snapshot current versions, while retaining every ancestor's person dependency.
    for (const p of inherited) {
      const current = (await db.query("select id,version from alter_profile where owner_id=$1 and id=$2 and archived_at is null", [owner, p.id])).rows[0];
      if (!current) throw new SystemError("NOT_FOUND", "Repair source is no longer available.");
      profiles.push({ id: current.id, version: Number(current.version) });
    }
    return { storage_key: r.storage_key, content_type: r.content_type, profiles };
  }
  async validate(db: Db, owner: string, recipe: Recipe) {
    if (recipe.repairSource) await this.source(db, owner, recipe.repairSource);
    for (const p of recipe.profiles) {
      const current = (await db.query("select version from alter_profile where owner_id=$1 and id=$2 and archived_at is null", [owner, p.id])).rows[0];
      if (!current || Number(current.version) !== p.version) throw new Error("A person's appearance changed. Start a new image request.");
    }
    for (const reference of recipe.references ?? []) {
      if (!(await db.query("select 1 from private_image where owner_id=$1 and id=$2 and alter_id=$3", [owner, reference.imageId, reference.alterId])).rowCount) throw new Error("A selected appearance reference is no longer available.");
    }
  }
  async choices(owner: string) {
    return (await this.pool.query(`select id,'private' as kind,'Gallery image' as label, '/api/v1/images/'||id as url from private_image where owner_id=$1
      union all select id,'native',left(recipe->>'scene',100),'/api/v1/native-scenes/renders/'||id||'/image' from native_scene_render where owner_id=$1 and state='COMPLETE'
      union all select id,'group','Finished group photo','/api/v1/group-photos/'||project_id||'/renders/'||id||'/image' from group_photo_render where owner_id=$1 and state='COMPLETE'`, [owner])).rows;
  }
}
