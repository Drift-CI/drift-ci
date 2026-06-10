import { sql } from 'drizzle-orm';

import { AUDIT_KINDS, recordAudit } from './audit';
import type { Db } from './db';
import { runs } from './schema';

/**
 * Retention sweep — deletes runs older than `started_at +
 * retention_days`. Each run carries its own retention so a workflow
 * can opt some suites into a longer history (e.g. compliance).
 *
 * Invariants the sweep preserves (arch §18, v1.3 B14):
 *   - `baseline_snapshots` rows survive forever — they have no FK to
 *     `runs` by design, so deleting a run leaves the snapshots in
 *     place. The case-detail page will say "previous run pruned" when
 *     it tries to resolve the source run for diff rendering.
 *   - `alert_events` (Phase 4) will cascade ON DELETE CASCADE so the
 *     sweep also removes their event-stream entries.
 *   - `alert_rules` (Phase 4) are NOT cascaded — they live across runs.
 *
 * The sweep is idempotent: running it twice in a row is a no-op the
 * second time.
 */

export interface RetentionSweepResult {
  runsDeleted: number;
  /** Wall-clock duration in ms — handy for the audit row. */
  durationMs: number;
}

export interface RetentionSweepOptions {
  /** Override clock for tests. */
  now?: Date;
  /**
   * When set, sweep up to this many runs and stop. Avoids holding a
   * long write lock on the runs table; further runs are deleted on
   * the next invocation. Default: 10_000.
   */
  batchLimit?: number;
}

export async function runRetentionSweep(
  db: Db,
  options: RetentionSweepOptions = {},
): Promise<RetentionSweepResult> {
  const start = Date.now();
  const now = options.now ?? new Date();
  const batchLimit = options.batchLimit ?? 10_000;

  // Postgres `make_interval` keeps the math in-DB so we never load
  // candidate rows into Node memory. The subquery picks ids whose
  // `started_at + retention_days < now`, capped at `batchLimit`.
  const result = await db.execute(sql`
    WITH expired AS (
      SELECT id FROM ${runs}
      WHERE started_at + make_interval(days => retention_days) < ${now.toISOString()}::timestamptz
      ORDER BY started_at ASC
      LIMIT ${batchLimit}
    )
    DELETE FROM ${runs}
    WHERE id IN (SELECT id FROM expired)
    RETURNING id
  `);

  const runsDeleted = readDeletedCount(result);
  const durationMs = Date.now() - start;

  // Always record the sweep so operators can see "we ran" in the audit
  // log even when nothing was deleted. Keeps observability simple.
  await recordAudit(db, {
    kind: AUDIT_KINDS.RETENTION_SWEPT,
    data: { runsDeleted, durationMs, batchLimit },
  });

  return { runsDeleted, durationMs };
}

// Drizzle's `db.execute()` returns slightly different shapes depending
// on driver. postgres-js wraps results as iterables with `.length`; pg
// returns `{ rows, rowCount }`. We handle both for portability.
interface DriverResult {
  length?: number;
  rowCount?: number | null;
  rows?: unknown[];
}

function readDeletedCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const r = result as DriverResult | undefined;
  if (!r) return 0;
  if (typeof r.length === 'number') return r.length;
  if (typeof r.rowCount === 'number') return r.rowCount;
  if (Array.isArray(r.rows)) return r.rows.length;
  /* c8 ignore next */
  return 0;
}
