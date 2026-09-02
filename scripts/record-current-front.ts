import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { normalizePgConnectionString } from "@/db/client";
import { SystemService } from "@/server/system-service";

function flag(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const targetName = flag("--alter");
const previousName = flag("--from");
const backfillStart = flag("--backfill-start");
const createMissing = process.argv.includes("--create");
if (!targetName) throw new Error("--alter is required.");
if (backfillStart && !previousName) throw new Error("--backfill-start requires --from.");
if (backfillStart && Number.isNaN(new Date(backfillStart).getTime())) throw new Error("--backfill-start must be an ISO timestamp.");

const connectionString = process.env.DATABASE_URL_UNPOOLED;
if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED is required.");

const pool = new Pool({ connectionString: normalizePgConnectionString(connectionString), max: 2 });
const service = new SystemService(pool);

async function activeAlter(ownerId: string, name: string) {
  const result = await pool.query<{ id: string }>(`select id from alter_profile
    where owner_id = $1 and name = $2 and archived_at is null order by created_at`, [ownerId, name]);
  if (result.rowCount !== 1) throw new Error(`Expected exactly one active alter named ${name}; found ${result.rowCount}.`);
  return result.rows[0].id;
}

async function main() {
  const owners = await pool.query<{ id: string }>("select id from app_user order by created_at");
  if (owners.rowCount !== 1) throw new Error(`Expected exactly one production owner; found ${owners.rowCount}.`);
  const ownerId = owners.rows[0].id;

  let target = await pool.query<{ id: string }>(`select id from alter_profile
    where owner_id = $1 and name = $2 and archived_at is null order by created_at`, [ownerId, targetName]);
  if (target.rowCount === 0 && createMissing) {
    await service.createAlter(ownerId, { requestId: randomUUID(), name: targetName }, "SYSTEM");
    target = await pool.query<{ id: string }>(`select id from alter_profile
      where owner_id = $1 and name = $2 and archived_at is null order by created_at`, [ownerId, targetName]);
  }
  if (target.rowCount !== 1) throw new Error(`Expected exactly one active alter named ${targetName}; found ${target.rowCount}.`);
  const targetId = target.rows[0].id;

  let current = await service.getCurrentFront(ownerId);
  if (!current && previousName) {
    if (!backfillStart) throw new Error("No current front exists; --backfill-start is required to preserve the previous front.");
    const previousId = await activeAlter(ownerId, previousName);
    current = (await service.switchCurrentFront(ownerId, {
      requestId: randomUUID(),
      alterId: previousId,
      expectedCurrentVersion: null,
      switchedAt: backfillStart,
    }, "SYSTEM")).data.current;
  }

  if (current && current.alterId !== targetId && previousName && current.alterName !== previousName) {
    throw new Error(`Expected ${previousName} to be current before the handoff; found ${current.alterName}.`);
  }
  if (current?.alterId !== targetId) {
    current = (await service.switchCurrentFront(ownerId, {
      requestId: randomUUID(),
      alterId: targetId,
      expectedCurrentVersion: current?.version ?? null,
    }, "SYSTEM")).data.current;
  }

  const history = await pool.query<{ name: string; started_at: Date; ended_at: Date | null; version: number }>(`select a.name, fs.started_at, fs.ended_at, fs.version
    from fronting_session fs join alter_profile a on a.owner_id = fs.owner_id and a.id = fs.alter_id
    where fs.owner_id = $1 order by fs.started_at`, [ownerId]);
  const open = history.rows.filter((row) => row.ended_at === null);
  if (open.length !== 1 || open[0].name !== targetName) throw new Error("The final current-front invariant failed.");
  console.log(JSON.stringify({
    currentFront: current.alterName,
    startedAt: current.startedAt,
    openCurrentFronts: open.length,
    history: history.rows.map((row) => ({ name: row.name, startedAt: row.started_at.toISOString(), endedAt: row.ended_at?.toISOString() ?? null, version: row.version })),
  }, null, 2));
}

void main().finally(() => pool.end());
