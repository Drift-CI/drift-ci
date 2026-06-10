import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let cachedSql: postgres.Sql | undefined;
let cachedDb: Db | undefined;

/**
 * Lazy, module-global Drizzle client. Next.js keeps the module alive
 * across server requests so we want a single postgres-js pool, not one
 * per request. Tests clear the cache via {@link __resetDbForTests}.
 */
export function getDb(): Db {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'drift-ci dashboard: DATABASE_URL env var is required (e.g. postgres://drift:drift@localhost:5432/drift_ci).',
    );
  }
  cachedSql = postgres(url, { max: 10, prepare: false });
  cachedDb = drizzle(cachedSql, { schema });
  return cachedDb;
}

/**
 * `SELECT 1` against the configured database. Returns `{ ok: true }` on
 * success or `{ ok: false, error }` on any failure — never throws so the
 * health route can report the failure mode as an HTTP body rather than
 * as a 500.
 */
export async function pingDb(): Promise<
  | { ok: true; latencyMs: number }
  | { ok: false; error: string }
> {
  const start = Date.now();
  try {
    const sql = getRawSql();
    await sql`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function getRawSql(): postgres.Sql {
  if (!cachedSql) {
    // Force client construction by calling getDb; then return the sql
    // handle for raw queries.
    getDb();
  }
  return cachedSql!;
}

/** Test-only: drop the cached pool so a later getDb() rebuilds from env. */
export async function __resetDbForTests(): Promise<void> {
  if (cachedSql) {
    await cachedSql.end({ timeout: 1 }).catch(() => undefined);
  }
  cachedSql = undefined;
  cachedDb = undefined;
}
