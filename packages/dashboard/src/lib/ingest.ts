import { z } from 'zod';

import type { Db } from './db';
import { baselineSnapshots, runs } from './schema';

// ─── envelope validation ─────────────────────────────────────────────────

const CaseStatusSchema = z.enum([
  'pass',
  'evaluator-error',
  'provider-rate-limit',
  'provider-network',
  'provider-auth',
  'timeout',
]);

// Matches CaseResult in @drift-ci/core/types/result.ts. Kept structurally
// compatible — duplicating the schema here avoids making the dashboard
// pull in all of core's dependencies (ajv, transformers, anthropic SDK).
const CaseResultSchema = z
  .object({
    caseId: z.string(),
    runId: z.string(),
    output: z.string().nullable(),
    score: z.number(),
    threshold: z.number(),
    latencyMs: z.number(),
    status: CaseStatusSchema,
    error: z.string().optional(),
    tokenUsage: z.record(z.unknown()).optional(),
    evaluatorBreakdown: z.record(z.unknown()).optional(),
  })
  .passthrough();

const RunResultSchema = z
  .object({
    id: z.string().uuid(),
    suiteId: z.string(),
    provider: z.string(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    cases: z.array(CaseResultSchema),
    summary: z.record(z.unknown()),
  })
  .passthrough();

const IngestContextSchema = z.object({
  suiteHashes: z.record(z.string()),
  judgeHash: z.string().optional(),
});

export const IngestEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  run: RunResultSchema,
  context: IngestContextSchema.optional(),
});

export type IngestEnvelope = z.infer<typeof IngestEnvelopeSchema>;

// ─── result ─────────────────────────────────────────────────────────────

export interface IngestOutcome {
  runId: string;
  runInserted: boolean;
  snapshotsWritten: number;
  snapshotsSkipped: number;
}

/**
 * Persist a validated ingest envelope. Writes are idempotent:
 *  - `runs` uses INSERT ... ON CONFLICT (id) DO NOTHING
 *  - `baseline_snapshots` uses ON CONFLICT (case_id, run_id) DO NOTHING,
 *    backing up the DB-level immutability trigger so repeat POSTs are
 *    no-ops rather than errors.
 *
 * When `context` is missing, snapshots are skipped entirely — the run
 * envelope is stored but we can't derive suiteHash. Callers SHOULD
 * supply context; the receiver accepts bare runs to avoid hard-fails
 * from older clients.
 */
export async function ingestRun(
  db: Db,
  envelope: IngestEnvelope,
): Promise<IngestOutcome> {
  const { run, context } = envelope;

  const insertedRun = await db
    .insert(runs)
    .values({
      id: run.id,
      suiteId: run.suiteId,
      provider: run.provider,
      startedAt: new Date(run.startedAt),
      completedAt: new Date(run.completedAt),
      data: run,
    })
    .onConflictDoNothing({ target: runs.id })
    .returning({ id: runs.id });

  const runInserted = insertedRun.length > 0;

  let snapshotsWritten = 0;
  let snapshotsSkipped = 0;

  if (context?.suiteHashes) {
    for (const caseResult of run.cases) {
      const suiteHash = context.suiteHashes[caseResult.caseId];
      if (!suiteHash) {
        snapshotsSkipped += 1;
        continue;
      }
      const written = await db
        .insert(baselineSnapshots)
        .values({
          caseId: caseResult.caseId,
          runId: run.id,
          suiteHash,
          judgeHash: context.judgeHash ?? null,
          score: caseResult.score,
          redactions: null,
        })
        .onConflictDoNothing({
          target: [baselineSnapshots.caseId, baselineSnapshots.runId],
        })
        .returning({ caseId: baselineSnapshots.caseId });
      if (written.length > 0) snapshotsWritten += 1;
      else snapshotsSkipped += 1;
    }
  } else {
    snapshotsSkipped = run.cases.length;
  }

  return {
    runId: run.id,
    runInserted,
    snapshotsWritten,
    snapshotsSkipped,
  };
}
