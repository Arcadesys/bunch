import { type Pool, type PoolClient } from "pg";
import { getDatabasePool } from "@/db/client";
import { SystemError } from "./system-error";
import type { ImageAllowance } from "@/domain/native-scene";

type Db = Pick<Pool, "query"> | PoolClient;
export type ImageJobKind = "native" | "group";
const tableFor = (kind: ImageJobKind) => kind === "native" ? "native_scene_render" : "group_photo_render";
export class ImageAllowanceService {
  constructor(readonly pool: Pool = getDatabasePool(), private operatorLimit?: number) {}
  async transaction<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try { await c.query("begin"); const result = await fn(c); await c.query("commit"); return result; }
    catch (error) { await c.query("rollback"); throw error; } finally { c.release(); }
  }
  async assertAccess(db: Db, owner: string) {
    const a = (await db.query("select a.*,p.gate_enabled,p.friends_enabled,p.uploads_enabled,p.capacity_verified_at,p.recovery_verified_at from pilot_policy p left join pilot_account a on a.owner_id=$1 where p.id", [owner])).rows[0];
    if (!a || (!a.owner_id && a.gate_enabled) || (a.owner_id && (a.state !== "ACTIVE" || (a.role === "FRIEND" && !a.friends_enabled)))) throw new SystemError("FORBIDDEN", "Image access is unavailable for this account.");
    return a;
  }
  async storagePreflight(db: Db, owner: string) {
    const a = await this.assertAccess(db, owner);
    if (a.role !== "FRIEND") return;
    const fresh = (value: unknown) => value && Date.now() - new Date(String(value)).getTime() <= 7 * 86400000 && new Date(String(value)).getTime() <= Date.now();
    if (!a.uploads_enabled || !fresh(a.capacity_verified_at) || !fresh(a.recovery_verified_at)) throw new SystemError("FORBIDDEN", "Private image storage is currently unavailable.");
    const used = Number((await db.query("select coalesce(sum(bytes),0) as n from pilot_upload where owner_id=$1", [owner])).rows[0].n);
    // Reserve headroom for the maximum normalized output; upload admission remains authoritative.
    if (used + 5 * 1024 * 1024 > Number(a.quota_bytes)) throw new SystemError("QUOTA_EXCEEDED", "Private image storage is full. Free at least 5 MB before generating or repairing an image.");
  }
  async read(owner: string, db: Db = this.pool, at = new Date()): Promise<ImageAllowance> {
    const a = await this.assertAccess(db, owner);
    const configured = this.operatorLimit ?? Number(process.env.NATIVE_SCENE_DAILY_LIMIT ?? 20);
    const operatorDefault = Number.isInteger(configured) && configured >= 0 && configured <= 1000 ? configured : 20;
    const limit = a.image_daily_limit ?? (a.role === "FRIEND" ? 10 : operatorDefault);
    const r = (await db.query(`select count(*) filter(where state='DISPATCHED')::int as used,count(*) filter(where state='RESERVED')::int as reserved,
      (((($2::timestamptz at time zone 'America/Chicago')::date+1)::timestamp at time zone 'America/Chicago')) as resets_at
      from image_usage where owner_id=$1 and admitted_on=($2::timestamptz at time zone 'America/Chicago')::date`, [owner, at])).rows[0];
    return { limit: Number(limit), used: r.used, reserved: r.reserved, remaining: Math.max(0, Number(limit)-r.used-r.reserved), resetsAt: new Date(r.resets_at).toISOString() };
  }
  async reserve(c: PoolClient, owner: string, kind: ImageJobKind, job: string) {
    // Caller holds the app_user row lock and creates the job in this transaction.
    const allowance = await this.read(owner, c);
    if (!allowance.remaining) throw new SystemError("QUOTA_EXCEEDED", "Your daily image allowance has been reached.", { allowance });
    await this.storagePreflight(c, owner);
    await c.query("insert into image_usage(owner_id,job_kind,job_id) values($1,$2,$3)", [owner, kind, job]);
  }
  async expire(owner: string) {
    await this.transaction(async c => {
      await c.query("select id from app_user where id=$1 for update", [owner]);
      await c.query("select set_config('app.pilot_purge',$1,true)", [owner]);
      for (const kind of ["native", "group"] as const) {
        await c.query(`update ${tableFor(kind)} set state='FAILED',finished_at=now(),error_message='Image processing was interrupted. Check your allowance before trying again.' where owner_id=$1 and state in ('QUEUED','RUNNING') and created_at < now()-interval '6 minutes'`, [owner]);
        await c.query(`update image_usage u set state='RELEASED' where u.owner_id=$1 and u.job_kind=$2 and u.state='RESERVED' and not exists(select 1 from ${tableFor(kind)} j where j.id=u.job_id and j.owner_id=u.owner_id and j.state in ('QUEUED','RUNNING'))`, [owner, kind]);
      }
    });
  }
  async claim(owner: string, kind: ImageJobKind, job: string) {
    try {
      return await this.transaction(async c => {
        await c.query("select id from app_user where id=$1 for update", [owner]);
        await this.assertAccess(c, owner);
        return (await c.query(`update ${tableFor(kind)} set state='RUNNING',started_at=now() where owner_id=$1 and id=$2 and state='QUEUED' returning *`, [owner, job])).rows[0];
      });
    } catch (error) {
      if (!(error instanceof SystemError) || error.code !== "FORBIDDEN") throw error;
      await this.failJob(owner, kind, job, "Image access is unavailable for this account.");
      return undefined;
    }
  }
  async failJob(owner: string, kind: ImageJobKind, job: string, message: string) {
    await this.transaction(async c => {
      await c.query("select id from app_user where id=$1 for update", [owner]);
      // Internal cleanup only: revocation must not prevent terminal status/refund.
      await c.query("select set_config('app.pilot_purge',$1,true)", [owner]);
      const changed = await c.query(`update ${tableFor(kind)} set state='FAILED',finished_at=now() where owner_id=$1 and id=$2 and state in ('QUEUED','RUNNING') returning id`, [owner, job]);
      if (!changed.rowCount) return;
      await c.query("update image_usage set state='RELEASED' where owner_id=$1 and job_kind=$2 and job_id=$3 and state='RESERVED'", [owner, kind, job]);
      const counted = (await c.query("select state from image_usage where owner_id=$1 and job_kind=$2 and job_id=$3", [owner, kind, job])).rows[0]?.state === "DISPATCHED";
      await c.query(`update ${tableFor(kind)} set error_message=$3 where owner_id=$1 and id=$2`, [owner, job, message + (counted ? " This attempt used 1 image use." : " No image use was spent.")]);
    });
  }
  async dispatch(owner: string, kind: ImageJobKind, job: string, validate?: (c: PoolClient) => Promise<void>) {
    await this.transaction(async c => {
      await c.query("select id from app_user where id=$1 for update", [owner]);
      await this.storagePreflight(c, owner);
      if (validate) await validate(c);
      const r = await c.query(`update image_usage set state='DISPATCHED',dispatched_at=now() where owner_id=$1 and job_kind=$2 and job_id=$3 and state='RESERVED' and exists(select 1 from ${tableFor(kind)} where id=$3 and owner_id=$1 and state='RUNNING' and created_at>=now()-interval '6 minutes') returning id`, [owner, kind, job]);
      if (!r.rowCount) throw new SystemError("CONFLICT", "Image processing was interrupted. Start a new request.");
    });
  }
  async recordUsage(owner: string, kind: ImageJobKind, job: string, usage: Record<string, number>) {
    await this.pool.query("update image_usage set provider_usage=$4 where owner_id=$1 and job_kind=$2 and job_id=$3", [owner, kind, job, JSON.stringify(usage)]);
  }
  async accounts(operator: string) {
    await this.requireOperator(this.pool, operator);
    return (await this.pool.query("select owner_id as id,display_name as name,role,state,image_daily_limit as override from pilot_account where state<>'DELETED' order by created_at")).rows;
  }
  async requireOperator(db: Db, owner: string) {
    const a = await this.assertAccess(db, owner);
    if (a.role !== "OPERATOR") throw new SystemError("FORBIDDEN", "Only the active Bunch operator can change image allowances.");
  }
  async setLimit(operator: string, owner: string, limit: number | null) {
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 1000)) throw new SystemError("VALIDATION_ERROR", "Choose a whole number between 0 and 1000.");
    await this.transaction(async c => {
      await this.requireOperator(c, operator);
      await c.query("select id from app_user where id=$1 for update", [owner]);
      if (!(await c.query("update pilot_account set image_daily_limit=$2 where owner_id=$1 and state<>'DELETED' returning owner_id", [owner, limit])).rowCount) throw new SystemError("NOT_FOUND", "Pilot account not found.");
    });
  }
}
