import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { SystemService } from "./system-service";
import { CatchUpService } from "./catch-up-service";

const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
integration(
  "catch-up selects an explicit period, keeps kind-specific windows and review state",
  async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const service = new SystemService(pool);
    const catchUp = new CatchUpService(pool);
    const owner = `period-catchup:${randomUUID()}`,
      other = `period-catchup:${randomUUID()}`;
    try {
      const a = (
        await service.createAlter(
          owner,
          { requestId: randomUUID(), name: "Period fixture" },
          "WEB",
        )
      ).data;
      await service.createAlter(
        other,
        { requestId: randomUUID(), name: "Other fixture" },
        "WEB",
      );
      await pool.query(
        "insert into presence_period(owner_id,alter_id,kind,started_at,ended_at) values ($1,$2,'FRONTING','2026-08-01T00:00:00Z','2026-08-02T00:00:00Z'),($1,$2,'HOSTING','2026-08-01T00:00:00Z','2026-08-03T00:00:00Z')",
        [owner, a.id],
      );
      const todo = (
        await service.createTodo(
          owner,
          {
            requestId: randomUUID(),
            title: "Preserved todo",
            assigneeAlterIds: [a.id],
          },
          "WEB",
        )
      ).data;
      const host = await service.setSystemHost(
        owner,
        { requestId: randomUUID(), alterId: a.id, expectedVersion: null },
        "WEB",
      );
      const front = await service.startFrontingEpisode(
        owner,
        { requestId: randomUUID(), alterId: a.id },
        "WEB",
      );
      const hosting = (await service.getCurrentPresence(owner)).hosting!;
      assert.equal(
        await catchUp.openForPresence(owner),
        null,
        "multiple periods require selection",
      );
      const handoff = await catchUp.prepareConversationCatchUp(owner, {
        alterId: a.id,
        periodId: front.data.id,
        timeZone: "America/Chicago",
      });
      assert.equal(handoff.window?.provenance, "RECORDED_PRESENCE_WINDOW");
      assert.equal(handoff.source?.kind, "FRONTING");
      assert.equal(handoff.window?.startAt, "2026-08-02T00:00:00.000Z");
      assert.equal(
        (
          await catchUp.prepareConversationCatchUp(owner, {
            alterId: a.id,
            timeZone: "America/Chicago",
          })
        ).status,
        "NEEDS_DATES",
      );
      const frontCatch = await catchUp.openForPresence(owner, front.data.id);
      const hostCatch = await catchUp.openForPresence(owner, hosting.id);
      assert.ok(frontCatch);
      assert.ok(hostCatch);
      assert.notEqual(frontCatch.id, hostCatch.id);
      assert.equal(frontCatch.sourceKind, "FRONTING");
      assert.equal(hostCatch.sourceKind, "HOSTING");
      assert.equal(frontCatch.windowStart, "2026-08-02T00:00:00.000Z");
      assert.equal(hostCatch.windowStart, "2026-08-03T00:00:00.000Z");
      assert.equal(frontCatch.presencePeriodId, front.data.id);
      assert.equal(await catchUp.openForPresence(other, front.data.id), null);
      const item = frontCatch.items.find((item) => item.itemId === todo.id)!;
      assert.ok(item);
      const reviewed = await catchUp.setItemState(
        owner,
        item.entryId,
        {
          requestId: randomUUID(),
          expectedVersion: item.version,
          state: "ACKNOWLEDGED",
        },
        "WEB",
      );
      assert.equal(reviewed.data.sourceKind, "FRONTING");
      assert.equal(reviewed.data.presencePeriodId, front.data.id);
      assert.equal((await service.getTodo(owner, todo.id)).status, todo.status);
      assert.equal(
        (await catchUp.openForPresence(owner, front.data.id))?.items.find(
          (i) => i.itemId === todo.id,
        )?.reviewState,
        "ACKNOWLEDGED",
      );
      assert.equal(
        (await catchUp.openForPresence(owner, hosting.id))?.items.find(
          (i) => i.itemId === todo.id,
        )?.reviewState,
        "NEW",
      );
      await service.setSystemHost(
        owner,
        {
          requestId: randomUUID(),
          alterId: null,
          expectedVersion: host.data.version,
        },
        "WEB",
      );
      assert.equal(await catchUp.openForPresence(owner, hosting.id), null);
      assert.equal(
        (await catchUp.openForPresence(owner))?.id,
        frontCatch.id,
        "sole remaining episode can be opened",
      );
      assert.equal(
        (
          await pool.query(
            "select count(*)::int as n from catch_up_session where owner_id=$1 and presence_period_id is not null",
            [owner],
          )
        ).rows[0].n,
        2,
      );
    } finally {
      await pool.query(
        "delete from todo_assignee where owner_id=any($1::text[])",
        [[owner, other]],
      );
      await pool.query("delete from app_user where id=any($1::text[])", [
        [owner, other],
      ]);
      await pool.end();
    }
  },
);
