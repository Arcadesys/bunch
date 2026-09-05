import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { PilotService } from "./pilot-service";
import { SystemService } from "./system-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration(
  "friends pilot isolates invitations, quotas, revocation, export and retryable deletion",
  async (t) => {
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const schema = `pilot_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`create schema ${schema}`);
    const pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema},public`,
    });
    const pilot = new PilotService(pool),
      service = new SystemService(pool, async () => {});
    const owner = `auth0:operator:${randomUUID()}`,
      a = `auth0:friend:${randomUUID()}`,
      b = `auth0:friend:${randomUUID()}`;
    try {
      await pool.query(await readFile("db/baseline.sql", "utf8"));
      for (const file of (await readdir("drizzle"))
        .filter((f) => f.endsWith(".sql"))
        .sort())
        await pool.query(await readFile(`drizzle/${file}`, "utf8"));
      await service.createAlter(
        owner,
        { requestId: randomUUID(), name: "Operator fixture" },
        "WEB",
      );
      await pilot.enrollOperator(owner);
      await assert.rejects(pilot.invite("a@example.test"), /closed/);
      await pool.query(
        "update pilot_policy set gate_enabled=true,friends_enabled=true,invitations_open=true,uploads_enabled=true,capacity_verified_at=now(),recovery_verified_at=now() where id",
      );
      let tokenA = "",
        tokenB = "";
      await t.test(
        "invites bind to verified identities, remain retry-safe, and cap at two",
        async () => {
          tokenA = await pilot.invite("a@example.test");
          tokenB = await pilot.invite("b@example.test");
          await pool.query(
            "update pilot_invitation set revoked_at=now() where email='a@example.test'",
          );
          await assert.rejects(
            pilot.accept(
              { ownerId: a, email: "a@example.test", emailVerified: true },
              tokenA,
              "A",
              true,
            ),
          );
          await pool.query(
            "update pilot_invitation set revoked_at=null,expires_at=now()-interval '1 second' where email='a@example.test'",
          );
          await assert.rejects(
            pilot.accept(
              { ownerId: a, email: "a@example.test", emailVerified: true },
              tokenA,
              "A",
              true,
            ),
          );
          await pool.query(
            "update pilot_invitation set expires_at=now()+interval '7 days' where email='a@example.test'",
          );
          await assert.rejects(pilot.invite("c@example.test"), /capacity/);
          await assert.rejects(
            pilot.accept(
              { ownerId: a, email: "a@example.test", emailVerified: false },
              tokenA,
              "A",
              true,
            ),
          );
          await assert.rejects(
            pilot.accept(
              { ownerId: a, email: "wrong@example.test", emailVerified: true },
              tokenA,
              "A",
              true,
            ),
          );
          await pilot.accept(
            { ownerId: a, email: "a@example.test", emailVerified: true },
            tokenA,
            "A",
            true,
          );
          assert.equal(
            (
              await pilot.accept(
                { ownerId: a, email: "a@example.test", emailVerified: true },
                tokenA,
                "A",
                true,
              )
            ).owner_id,
            a,
          );
          await assert.rejects(
            pilot.accept(
              { ownerId: b, email: "a@example.test", emailVerified: true },
              tokenA,
              "B",
              true,
            ),
          );
          await pilot.accept(
            { ownerId: b, email: "b@example.test", emailVerified: true },
            tokenB,
            "B",
            true,
          );
        },
      );
      const alterA = (
        await service.createAlter(
          a,
          { requestId: randomUUID(), name: "Only A" },
          "WEB",
        )
      ).data;
      await service.createAlter(
        b,
        { requestId: randomUUID(), name: "Only B" },
        "WEB",
      );
      await t.test(
        "cross-owner IDs cannot read or mutate and exports contain only own records",
        async () => {
          await assert.rejects(service.getAlter(b, alterA.id));
          await assert.rejects(
            service.updateAlter(
              b,
              alterA.id,
              { requestId: randomUUID(), expectedVersion: 1, name: "No" },
              "WEB",
            ),
          );
          const exported = await pilot.export(b);
          assert.ok(!JSON.stringify(exported).includes("Only A"));
          assert.ok(JSON.stringify(exported).includes("Only B"));
          await assert.rejects(pilot.export("auth0:unknown"));
        },
      );
      await t.test(
        "parallel uploads atomically enforce 50 MB including reservations",
        async () => {
          const results = await Promise.allSettled([
            pilot.reserveUpload(a, "fixture/a1", 30 * 1048576),
            pilot.reserveUpload(a, "fixture/a2", 30 * 1048576),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(
            Number(
              (
                await pool.query(
                  "select sum(bytes) as n from pilot_upload where owner_id=$1",
                  [a],
                )
              ).rows[0].n,
            ),
            30 * 1048576,
          );
        },
      );
      await t.test(
        "rate limit and revocation protect access and database writes",
        async () => {
          for (let i = 0; i < 10; i++) await pilot.rate(b, "upload");
          await assert.rejects(pilot.rate(b, "upload"), /wait a minute/);
          await pool.query(
            "update pilot_account set state='REVOKED' where owner_id=$1",
            [b],
          );
          await assert.rejects(pilot.assertAccess(b));
          await assert.rejects(
            service.createAlter(
              b,
              { requestId: randomUUID(), name: "Blocked" },
              "WEB",
            ),
          );
          assert.ok(
            (await pilot.export(b)).data.alter_profile.length === 1,
            "revoked users can still export",
          );
        },
      );
      await t.test(
        "deletion stops access, waits for uploads, retries file failures, and preserves other owner",
        async () => {
          await pilot.beginDeletion(a);
          await assert.rejects(pilot.assertAccess(a));
          assert.equal(
            (await pilot.finishDeletion(a, async () => {})).state,
            "DELETING",
          );
          await pool.query(
            "update pilot_upload set state='STORED' where owner_id=$1",
            [a],
          );
          await assert.rejects(
            pilot.finishDeletion(a, async () => {
              throw new Error("Storage unavailable");
            }),
          );
          assert.equal((await pilot.account(a))?.state, "DELETING");
          const keys: string[] = [];
          assert.equal(
            (
              await pilot.finishDeletion(a, async (values) => {
                keys.push(...values);
              })
            ).state,
            "DELETED",
          );
          assert.equal(keys.length, 1);
          assert.equal(
            (await pool.query("select 1 from app_user where id=$1", [a]))
              .rowCount,
            0,
          );
          assert.equal(
            (await pool.query("select 1 from app_user where id=$1", [b]))
              .rowCount,
            1,
          );
          assert.equal(
            (
              await pilot.finishDeletion(a, async () => {
                throw new Error("Should not repeat");
              })
            ).state,
            "DELETED",
          );
          await assert.rejects(
            pilot.accept(
              { ownerId: a, email: "a@example.test", emailVerified: true },
              tokenA,
              "A",
              true,
            ),
          );
        },
      );
      await t.test(
        "stale capacity evidence stops new invitations and uploads",
        async () => {
          await pool.query(
            "update pilot_policy set capacity_verified_at=now()-interval '8 days' where id",
          );
          await assert.rejects(pilot.invite("late@example.test"), /closed/);
          await assert.rejects(pilot.reserveUpload(b, "fixture/late", 1024));
        },
      );
      await t.test(
        "rollback pauses friends without disrupting the enrolled operator",
        async () => {
          await pool.query(
            "update pilot_policy set invitations_open=false,friends_enabled=false where id",
          );
          await pilot.assertAccess(owner);
          await assert.rejects(pilot.assertAccess(b));
        },
      );
    } finally {
      await pool.end();
      await admin.query(`drop schema ${schema} cascade`);
      await admin.end();
    }
  },
);
