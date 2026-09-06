import { createHash, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getDatabasePool } from "@/db/client";
import { SystemError } from "./system-error";

export type PilotIdentity = {
  ownerId: string;
  email: string;
  emailVerified: boolean;
};
export type PilotAccount = {
  owner_id: string;
  role: "OPERATOR" | "FRIEND";
  state: "ACTIVE" | "REVOKED" | "DELETING" | "DELETED";
  display_name: string;
  quota_bytes: string;
};
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function freshEvidence(policy: {
  capacity_verified_at: string | Date | null;
  recovery_verified_at: string | Date | null;
}) {
  return [policy.capacity_verified_at, policy.recovery_verified_at].every(
    (value) =>
      value &&
      Date.now() - new Date(value).getTime() <= 7 * 86400000 &&
      new Date(value).getTime() <= Date.now(),
  );
}
const unavailable = () =>
  new SystemError(
    "FORBIDDEN",
    "This account does not have active DIDdy access. Visit /join or /account.",
  );
export const OWNER_TABLES = [
  "conversation_summary",
  "catch_up_entry",
  "catch_up_session",
  "important_thread_recipient",
  "system_decision_recipient",
  "todo_assignee",
  "activity_event",
  "mutation_receipt",
  "system_host",
  "presence_period",
  "fronting_session",
  "system_note",
  "system_todo",
  "system_decision",
  "important_thread",
  "private_image",
  "alter_alias",
  "coverage_assignment",
  "alter_profile",
  "system_preference",
] as const;

export class PilotService {
  constructor(readonly pool: Pool = getDatabasePool()) {}
  async transaction<T>(run: (client: PoolClient) => Promise<T>) {
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
  async account(ownerId: string) {
    return (
      (
        await this.pool.query<PilotAccount>(
          "select * from pilot_account where owner_id=$1",
          [ownerId],
        )
      ).rows[0] ?? null
    );
  }
  async assertAccess(ownerId: string, bucket?: string) {
    const [account, policy] = await Promise.all([
      this.account(ownerId),
      this.pool.query("select * from pilot_policy where id"),
    ]);
    const p = policy.rows[0];
    if (!p) throw unavailable();
    if (!account) {
      if (p.gate_enabled) throw unavailable();
      return;
    }
    if (
      account.state !== "ACTIVE" ||
      (account.role === "FRIEND" && !p.friends_enabled)
    )
      throw unavailable();
    if (bucket && account.role === "FRIEND") await this.rate(ownerId, bucket);
  }
  async rate(ownerId: string, bucket: string) {
    const limit = bucket === "image" ? 120 : bucket === "upload" ? 10 : 60;
    const result = await this.pool.query(
      `insert into pilot_rate(owner_id,bucket,window_start,count) values($1,$2,date_trunc('minute',now()),1)
      on conflict(owner_id,bucket) do update set window_start=excluded.window_start,
      count=case when pilot_rate.window_start=excluded.window_start then pilot_rate.count+1 else 1 end returning count`,
      [ownerId, bucket],
    );
    if (result.rows[0].count > limit)
      throw new SystemError(
        "RATE_LIMITED",
        "Please wait a minute before trying again.",
      );
  }
  async enrollOperator(ownerId: string) {
    if (!ownerId.startsWith("auth0:"))
      throw new Error("An explicit Auth0 owner ID is required.");
    await this.transaction(async (c) => {
      await c.query("select id from pilot_policy where id for update");
      if (
        !(await c.query("select 1 from app_user where id=$1", [ownerId]))
          .rowCount
      )
        throw new Error("Existing owner not found.");
      await c.query(
        "insert into pilot_account(owner_id,role,privacy_accepted_at) values($1,'OPERATOR',now()) on conflict(owner_id) do nothing",
        [ownerId],
      );
    });
  }
  async invite(email: string) {
    const token = randomBytes(32).toString("base64url");
    await this.transaction(async (c) => {
      const p = (
        await c.query("select * from pilot_policy where id for update")
      ).rows[0];
      if (!p.invitations_open || !p.friends_enabled || !freshEvidence(p))
        throw new Error(
          "Invitations are closed until capacity and recovery are verified.",
        );
      const count = (
        await c.query(`select (select count(*) from pilot_account where role='FRIEND' and state<>'DELETED') +
        (select count(*) from pilot_invitation where accepted_by is null and revoked_at is null and expires_at>now()) as n`)
      ).rows[0].n;
      if (Number(count) >= p.max_friends)
        throw new Error("Pilot capacity is full.");
      await c.query(
        "insert into pilot_invitation(token_hash,email,expires_at) values($1,$2,now()+interval '7 days')",
        [digest(token), email.trim().toLowerCase()],
      );
    });
    return token;
  }
  async accept(
    identity: PilotIdentity,
    token: string,
    displayName: string,
    accepted: boolean,
  ) {
    if (!identity.emailVerified || !identity.email || !accepted)
      throw new SystemError(
        "FORBIDDEN",
        "Verify your email and accept the privacy notice first.",
      );
    return this.transaction(async (c) => {
      const p = (
        await c.query("select * from pilot_policy where id for update")
      ).rows[0];
      if (!p.invitations_open || !p.friends_enabled || !freshEvidence(p))
        throw unavailable();
      const i = (
        await c.query(
          "select * from pilot_invitation where token_hash=$1 for update",
          [digest(token)],
        )
      ).rows[0];
      if (!i || i.revoked_at || new Date(i.expires_at).getTime() <= Date.now())
        throw new SystemError(
          "FORBIDDEN",
          "This invitation is unavailable for this verified account.",
        );
      if (i.accepted_by) {
        if (i.accepted_by !== identity.ownerId) throw unavailable();
        const existing = (
          await c.query<PilotAccount>(
            "select * from pilot_account where owner_id=$1",
            [identity.ownerId],
          )
        ).rows[0];
        if (existing?.state !== "ACTIVE") throw unavailable();
        return existing;
      }
      if (i.email !== identity.email.toLowerCase().trim()) throw unavailable();
      if (
        (
          await c.query("select 1 from pilot_account where owner_id=$1", [
            identity.ownerId,
          ])
        ).rowCount
      )
        throw new SystemError("CONFLICT", "This account is already enrolled.");
      const count = Number(
        (
          await c.query(
            "select count(*) as n from pilot_account where role='FRIEND' and state<>'DELETED'",
          )
        ).rows[0].n,
      );
      if (count >= p.max_friends)
        throw new SystemError("CONFLICT", "Pilot capacity is full.");
      const account = (
        await c.query<PilotAccount>(
          "insert into pilot_account(owner_id,role,display_name,privacy_accepted_at) values($1,'FRIEND',$2,now()) returning *",
          [identity.ownerId, displayName],
        )
      ).rows[0];
      await c.query(
        "insert into app_user(id,google_subject) values($1,$1) on conflict do nothing",
        [identity.ownerId],
      );
      await c.query(
        "update pilot_invitation set accepted_by=$2,email='' where id=$1",
        [i.id, identity.ownerId],
      );
      return account;
    });
  }
  async export(ownerId: string) {
    return this.transaction(async (c) => {
      await c.query(
        "set transaction isolation level repeatable read read only",
      );
      const a = (
        await c.query<PilotAccount>(
          "select * from pilot_account where owner_id=$1",
          [ownerId],
        )
      ).rows[0];
      if (!a || a.state === "DELETING" || a.state === "DELETED")
        throw unavailable();
      const data: Record<string, unknown[]> = {};
      for (const table of OWNER_TABLES) {
        if (table === "mutation_receipt") continue; // Internal retry payloads are not user records.
        const rows = (
          await c.query(`select * from ${table} where owner_id=$1${table === "conversation_summary" ? " and expires_at>now()" : ""}`, [ownerId])
        ).rows;
        data[table] = rows.map((row) => {
          const clean = { ...row };
          delete clean.owner_id;
          delete clean.storage_key;
          return clean;
        });
      }
      const images = (
        await c.query("select id from private_image where owner_id=$1", [
          ownerId,
        ])
      ).rows.map((row) => ({
        id: row.id,
        downloadUrl: `/api/v1/account/images/${row.id}`,
      }));
      const preferences = (
        await c.query("select time_zone from app_user where id=$1", [ownerId])
      ).rows[0];
      return {
        formatVersion: 1,
        exportedAt: new Date().toISOString(),
        systemName: a.display_name,
        preferences,
        data,
        images,
      };
    });
  }
  async beginDeletion(ownerId: string) {
    await this.transaction(async (c) => {
      const account = (
        await c.query<PilotAccount>(
          "select * from pilot_account where owner_id=$1 for update",
          [ownerId],
        )
      ).rows[0];
      if (!account || account.role === "OPERATOR")
        throw new SystemError(
          "FORBIDDEN",
          "The hosting operator account cannot be deleted through the pilot.",
        );
      if (account.state === "DELETED") return;
      await c.query(
        "update pilot_account set state='DELETING' where owner_id=$1",
        [ownerId],
      );
    });
  }
  async finishDeletion(
    ownerId: string,
    remove: (keys: string[]) => Promise<void>,
  ) {
    return this.transaction(async (c) => {
      const a = (
        await c.query<PilotAccount>(
          "select * from pilot_account where owner_id=$1 for update",
          [ownerId],
        )
      ).rows[0];
      if (a?.state === "DELETED") return { state: "DELETED" as const };
      if (a?.state !== "DELETING") throw unavailable();
      // Reservations are committed before file transfer. Retry until all have settled.
      if (
        (
          await c.query(
            "select 1 from pilot_upload where owner_id=$1 and state='RESERVED'",
            [ownerId],
          )
        ).rowCount
      )
        return { state: "DELETING" as const, retryable: true };
      const keys = (
        await c.query(
          "select storage_key from private_image where owner_id=$1 union select storage_key from pilot_upload where owner_id=$1",
          [ownerId],
        )
      ).rows.map((r) => r.storage_key);
      await remove(keys);
      await c.query("select set_config('app.pilot_purge',$1,true)", [ownerId]);
      for (const table of OWNER_TABLES)
        await c.query(`delete from ${table} where owner_id=$1`, [ownerId]);
      // Also covers legacy tables not represented in current contracts.
      await c.query("delete from app_user where id=$1", [ownerId]);
      await c.query("delete from pilot_upload where owner_id=$1", [ownerId]);
      await c.query("delete from pilot_rate where owner_id=$1", [ownerId]);
      await c.query("delete from pilot_invitation where accepted_by=$1", [
        ownerId,
      ]);
      await c.query(
        "update pilot_account set state='DELETED',display_name='',privacy_accepted_at=null,deleted_at=now() where owner_id=$1",
        [ownerId],
      );
      return { state: "DELETED" as const };
    });
  }
  async reserveUpload(ownerId: string, key: string, bytes: number) {
    await this.transaction(async (c) => {
      const a = (
        await c.query<PilotAccount>(
          "select * from pilot_account where owner_id=$1 for update",
          [ownerId],
        )
      ).rows[0];
      const p = (await c.query("select * from pilot_policy where id")).rows[0];
      if (!a) {
        if (p.gate_enabled) throw unavailable();
        return;
      }
      if (
        a.state !== "ACTIVE" ||
        (a.role === "FRIEND" &&
          (!p.friends_enabled || !p.uploads_enabled || !freshEvidence(p)))
      )
        throw unavailable();
      const used = Number(
        (
          await c.query(
            "select coalesce(sum(bytes),0) as n from pilot_upload where owner_id=$1",
            [ownerId],
          )
        ).rows[0].n,
      );
      if (a.role === "FRIEND" && used + bytes > Number(a.quota_bytes))
        throw new SystemError(
          "QUOTA_EXCEEDED",
          "Your 50 MB image allowance is full. Delete images before uploading more.",
        );
      await c.query(
        "insert into pilot_upload(storage_key,owner_id,bytes,state) values($1,$2,$3,'RESERVED')",
        [key, ownerId, bytes],
      );
    });
  }
}
export const getPilotService = () => new PilotService();
