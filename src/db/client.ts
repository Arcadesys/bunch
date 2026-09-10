import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";

const globalDatabase = globalThis as typeof globalThis & { systemPool?: Pool };

export function normalizePgConnectionString(connectionString: string) {
  const url = new URL(connectionString);
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

// One pooled connection for request handling. Migrations deliberately do not use
// this: they need an unpooled session to hold an advisory lock. The global cache is
// dev-only, where hot reload would otherwise leak a pool per reload.
export function getDatabasePool() {
  if (globalDatabase.systemPool) return globalDatabase.systemPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Postgres is not configured.");
  const pool = new Pool({ connectionString: normalizePgConnectionString(connectionString), max: 10 });
  attachDatabasePool(pool);
  if (process.env.NODE_ENV !== "production") globalDatabase.systemPool = pool;
  return pool;
}

export function getDatabase() {
  return drizzle(getDatabasePool(), { schema });
}
