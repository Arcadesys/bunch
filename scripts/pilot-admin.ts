import "dotenv/config";
import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { PilotService } from "../src/server/pilot-service";
import { del } from "@vercel/blob";

const command = process.argv[2],
  value = process.argv[3];
if (!process.env.DATABASE_URL_UNPOOLED)
  throw new Error("DATABASE_URL_UNPOOLED is required.");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED,
  max: 2,
});
const pilot = new PilotService(pool);
const evidenceSchema = z
  .object({
    checkedAt: z.string().datetime(),
    baselineMonthlyUsd: z.number().nonnegative(),
    additionalCommittedUsd: z.literal(0),
    capacityWithinExistingAllowances: z.literal(true),
    providers: z.object({
      vercel: z.string().min(1),
      postgres: z.string().min(1),
      auth0: z.string().min(1),
      blob: z.string().min(1),
    }),
    recovery: z.object({
      days: z.literal(7),
      encrypted: z.literal(true),
      restoreTestPassed: z.literal(true),
      restoreReport: z.string().min(1),
      deletionReplayTestPassed: z.literal(true),
    }),
    spendControls: z.string().min(1),
    pilotSlots: z.number().int().min(1).max(2),
  })
  .strict();
async function main() {
  try {
    if (command === "status") {
      console.log(
        JSON.stringify(
          {
            policy: (await pool.query("select * from pilot_policy")).rows[0],
            accounts: (
              await pool.query(
                "select role,state,count(*)::int from pilot_account group by role,state",
              )
            ).rows,
          },
          null,
          2,
        ),
      );
    } else if (command === "enroll-operator") {
      await pilot.enrollOperator(z.string().startsWith("auth0:").parse(value));
      console.log("Existing operator enrolled. Gate remains unchanged.");
    } else if (command === "lock-gate") {
      await pilot.transaction(async c => {
        await c.query("select id from pilot_policy where id for update");
        if (!(await c.query("select 1 from pilot_account where role='OPERATOR' and state='ACTIVE'")).rowCount) throw new Error("Enroll the operator first.");
        if ((await c.query("select 1 from app_user u left join pilot_account a on a.owner_id=u.id where a.owner_id is null")).rowCount) throw new Error("Audit unenrolled accounts before enabling the gate.");
        await c.query("update pilot_policy set gate_enabled=true,invitations_open=false,friends_enabled=false,uploads_enabled=false where id");
      });
      console.log("Membership gate enabled. Friend access and invitations remain closed.");
    } else if (command === "open") {
      const evidence = evidenceSchema.parse(
        JSON.parse(await readFile(value, "utf8")),
      );
      if (
        Date.now() - Date.parse(evidence.checkedAt) > 7 * 86400000 ||
        Date.parse(evidence.checkedAt) > Date.now()
      )
        throw new Error("Evidence must be from the last seven days.");
      await pilot.transaction(async (c) => {
        await c.query("select id from pilot_policy where id for update");
        if (
          !(
            await c.query(
              "select 1 from pilot_account where role='OPERATOR' and state='ACTIVE'",
            )
          ).rowCount
        )
          throw new Error("Enroll existing operator first.");
        const unclassified = await c.query(
          "select 1 from app_user u left join pilot_account a on a.owner_id=u.id where a.owner_id is null",
        );
        if (unclassified.rowCount)
          throw new Error(
            "Unenrolled existing accounts remain. Audit them before enabling access enforcement.",
          );
        await c.query(
          "update pilot_policy set gate_enabled=true,friends_enabled=true,invitations_open=true,uploads_enabled=true,max_friends=$1,capacity_verified_at=$2,recovery_verified_at=$2,evidence=$3 where id",
          [evidence.pilotSlots, evidence.checkedAt, JSON.stringify(evidence)],
        );
      });
      console.log("Pilot opened for the verified capacity.");
    } else if (command === "invite") {
      const token = await pilot.invite(z.string().email().parse(value));
      console.log(
        `Invitation code (deliver privately; expires in seven days): ${token}`,
      );
    } else if (command === "revoke-invite") {
      await pool.query(
        "update pilot_invitation set revoked_at=now() where id=$1 and accepted_by is null",
        [z.string().uuid().parse(value)],
      );
      console.log("Invitation revoked if unused.");
    } else if (command === "revoke") {
      await pool.query(
        "update pilot_account set state='REVOKED' where owner_id=$1 and role='FRIEND' and state='ACTIVE'",
        [value],
      );
      console.log("Friend access revoked if active.");
    } else if (command === "freeze") {
      await pool.query(
        "update pilot_policy set invitations_open=false,uploads_enabled=false where id",
      );
      console.log(
        "Invitations and friend uploads frozen; existing access preserved.",
      );
    } else if (command === "pause") {
      await pool.query(
        "update pilot_policy set invitations_open=false,uploads_enabled=false,friends_enabled=false where id",
      );
      console.log(
        "Friend access paused. Operator access and friend exports/deletion remain available.",
      );
    } else if (command === "reconcile-uploads") {
      // Vercel transfer requests must have a shorter maximum duration than this grace period.
      const rows = (
        await pool.query(
          "select storage_key from pilot_upload where state='RESERVED' and created_at<now()-interval '1 hour'",
        )
      ).rows;
      for (const row of rows) {
        const attached = await pool.query(
          "select 1 from private_image where storage_key=$1",
          [row.storage_key],
        );
        if (attached.rowCount)
          await pool.query(
            "update pilot_upload set state='STORED' where storage_key=$1",
            [row.storage_key],
          );
        else {
          await del([row.storage_key]);
          await pool.query("delete from pilot_upload where storage_key=$1", [
            row.storage_key,
          ]);
        }
      }
      console.log(`Reconciled ${rows.length} expired reservations.`);
    } else if (command === "retry-deletions") {
      const rows = (
        await pool.query(
          "select owner_id from pilot_account where state='DELETING'",
        )
      ).rows;
      for (const row of rows)
        await pilot.finishDeletion(row.owner_id, async (keys) => {
          if (keys.length) await del(keys);
        });
      console.log(`Attempted ${rows.length} pending deletions.`);
    } else
      throw new Error(
        "Usage: pilot-admin.ts status | enroll-operator OWNER | lock-gate | open EVIDENCE.json | invite EMAIL | revoke-invite UUID | revoke OWNER | freeze | pause | reconcile-uploads | retry-deletions",
      );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Pilot operation failed.",
  );
  process.exitCode = 1;
});
