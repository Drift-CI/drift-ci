import { and, desc, eq, lt, or } from 'drizzle-orm';

import type { Db } from './db';
import { baselineSnapshots, runs } from './schema';
import { encodeCursor, type RunCursor } from './cursor';

export interface ListRunsParams {
  suiteId?: string;
  limit: number;
  cursor: RunCursor | null;
}

export interface RunListItem {
  id: string;
  suiteId: string;
  provider: string;
  startedAt: Date;
  completedAt: Date;
  receivedAt: Date;
  data: unknown;
}

export interface ListRunsResult {
  rows: RunListItem[];
  nextCursor: string | null;
}

/**
 * Cursor-paginated run list. We over-fetch by one row to detect whether
 * a next page exists without a separate COUNT query — the trailing row
 * is dropped before returning and its (started_at, id) becomes the
 * `nextCursor` for the next call.
 */
export async function listRunsPaged(
  db: Db,
  params: ListRunsParams,
): Promise<ListRunsResult> {
  const { suiteId, limit, cursor } = params;

  const where = and(
    suiteId ? eq(runs.suiteId, suiteId) : undefined,
    cursor
      ? or(
          lt(runs.startedAt, new Date(cursor.startedAt)),
          and(eq(runs.startedAt, new Date(cursor.startedAt)), lt(runs.id, cursor.id)),
        )
      : undefined,
  );

  const rows = await db
    .select({
      id: runs.id,
      suiteId: runs.suiteId,
      provider: runs.provider,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
      receivedAt: runs.receivedAt,
      data: runs.data,
    })
    .from(runs)
    .where(where)
    .orderBy(desc(runs.startedAt), desc(runs.id))
    .limit(limit + 1);

  let nextCursor: string | null = null;
  let trimmed = rows;
  if (rows.length > limit) {
    trimmed = rows.slice(0, limit);
    const last = trimmed[trimmed.length - 1];
    nextCursor = encodeCursor({
      startedAt: last.startedAt.toISOString(),
      id: last.id,
    });
  }
  return { rows: trimmed, nextCursor };
}

export interface RunDetail extends RunListItem {
  data: unknown;
}

export async function getRunById(
  db: Db,
  id: string,
): Promise<RunDetail | null> {
  const result = await db
    .select({
      id: runs.id,
      suiteId: runs.suiteId,
      provider: runs.provider,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
      receivedAt: runs.receivedAt,
      data: runs.data,
    })
    .from(runs)
    .where(eq(runs.id, id))
    .limit(1);
  return result[0] ?? null;
}

// ─── case shape ──────────────────────────────────────────────────────────
//
// Cases live inside `runs.data.cases[]` rather than their own table. We
// destructure on read because that's where the run envelope lands. M19b
// joins this with `baseline_snapshots` to render an old→new diff.

export interface RunCase {
  caseId: string;
  output: string | null;
  score: number;
  threshold: number;
  latencyMs: number;
  status: string;
  error?: string;
  evaluatorBreakdown?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
}

export function extractCase(run: RunDetail, caseId: string): RunCase | null {
  const data = run.data as { cases?: RunCase[] } | null;
  if (!data?.cases) return null;
  const found = data.cases.find((c) => c.caseId === caseId);
  return found ?? null;
}

// ─── snapshot history ───────────────────────────────────────────────────

export interface PreviousSnapshot {
  runId: string;
  capturedAt: Date;
  score: number;
  suiteHash: string;
  judgeHash: string | null;
  output: string | null;
}

/**
 * Look up the most recent baseline_snapshot for `caseId` strictly older
 * than `currentRunCapturedAt`, then resolve the corresponding run's
 * recorded output for that case so the UI can render an old → new
 * diff. Returns null when no prior snapshot exists.
 *
 * Snapshot rows live forever (retention preserves them), so the
 * lookup may resolve a run that has since been deleted — when that
 * happens we still return the score + capturedAt but `output` is null.
 */
export async function getPreviousSnapshotForCase(
  db: Db,
  params: {
    caseId: string;
    /** captured_at of the current run; we want the snapshot strictly before this. */
    currentRunCapturedAt: Date;
    /** Optional matching suiteHash. When omitted, returns the closest snapshot regardless of suite version. */
    suiteHash?: string;
  },
): Promise<PreviousSnapshot | null> {
  const where = and(
    eq(baselineSnapshots.caseId, params.caseId),
    lt(baselineSnapshots.capturedAt, params.currentRunCapturedAt),
    params.suiteHash
      ? eq(baselineSnapshots.suiteHash, params.suiteHash)
      : undefined,
  );
  const rows = await db
    .select({
      runId: baselineSnapshots.runId,
      capturedAt: baselineSnapshots.capturedAt,
      score: baselineSnapshots.score,
      suiteHash: baselineSnapshots.suiteHash,
      judgeHash: baselineSnapshots.judgeHash,
    })
    .from(baselineSnapshots)
    .where(where)
    .orderBy(desc(baselineSnapshots.capturedAt))
    .limit(1);

  const snap = rows[0];
  if (!snap) return null;

  // Resolve the run that produced this snapshot to grab the recorded
  // output. The run may have been deleted by retention, in which case
  // we surface score-only.
  const runRow = await getRunById(db, snap.runId);
  const previousCase = runRow ? extractCase(runRow, params.caseId) : null;

  return {
    runId: snap.runId,
    capturedAt: snap.capturedAt,
    score: snap.score,
    suiteHash: snap.suiteHash,
    judgeHash: snap.judgeHash,
    output: previousCase?.output ?? null,
  };
}

// ─── timeline ───────────────────────────────────────────────────────────

export interface TimelinePoint {
  runId: string;
  capturedAt: Date;
  score: number;
}

/**
 * Returns the historical (capturedAt, score) series for a single
 * caseId, oldest → newest, suitable for plotting on a sparkline.
 * Default depth is 30 points; cap at 200 to keep payloads cheap.
 */
export async function getCaseTimeline(
  db: Db,
  params: { caseId: string; suiteHash?: string; limit?: number },
): Promise<TimelinePoint[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 30), 200);
  const where = and(
    eq(baselineSnapshots.caseId, params.caseId),
    params.suiteHash
      ? eq(baselineSnapshots.suiteHash, params.suiteHash)
      : undefined,
  );
  const rows = await db
    .select({
      runId: baselineSnapshots.runId,
      capturedAt: baselineSnapshots.capturedAt,
      score: baselineSnapshots.score,
    })
    .from(baselineSnapshots)
    .where(where)
    .orderBy(desc(baselineSnapshots.capturedAt))
    .limit(limit);

  // We fetched newest-first; reverse so the chart reads left→right
  // chronologically.
  return rows.slice().reverse();
}
