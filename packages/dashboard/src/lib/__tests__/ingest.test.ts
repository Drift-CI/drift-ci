import { describe, it, expect } from 'vitest';
import { IngestEnvelopeSchema, ingestRun, type IngestEnvelope } from '../ingest';
import { baselineSnapshots, runs } from '../schema';
import type { Db } from '../db';

// ─── minimal in-memory Drizzle fake ──────────────────────────────────────
//
// We match just the surface ingestRun uses:
//   db.insert(table).values(row).onConflictDoNothing(...).returning(...)
//
// Each returning() resolves to an array of {id|caseId}. The fake treats
// the registered primary-key columns as the conflict key so we can
// simulate "already exists" skips.

interface FakeTable {
  rows: Array<Record<string, unknown>>;
  primaryKey: string[];
}

function createFakeDb(): { db: Db; tables: Record<string, FakeTable> } {
  const tables: Record<string, FakeTable> = {
    runs: { rows: [], primaryKey: ['id'] },
    baseline_snapshots: { rows: [], primaryKey: ['caseId', 'runId'] },
  };

  const insert = (table: typeof runs | typeof baselineSnapshots) => {
    const name = table === runs ? 'runs' : 'baseline_snapshots';
    const t = tables[name]!;
    return {
      values(row: Record<string, unknown>) {
        let conflict = false;
        return {
          onConflictDoNothing() {
            return {
              async returning() {
                const exists = t.rows.some((r) =>
                  t.primaryKey.every((k) => r[k] === row[k]),
                );
                if (exists) {
                  conflict = true;
                  return [];
                }
                t.rows.push(row);
                return [row];
              },
            };
          },
          // Unused paths — stub so TS is happy if the production code
          // ever accidentally omits onConflictDoNothing.
          async returning() {
            t.rows.push(row);
            return [row];
          },
          get _conflict() {
            return conflict;
          },
        };
      },
    };
  };

  const db = { insert } as unknown as Db;
  return { db, tables };
}

// ─── fixtures ────────────────────────────────────────────────────────────

function makeEnvelope(overrides: Partial<IngestEnvelope> = {}): IngestEnvelope {
  return {
    schemaVersion: 1,
    run: {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      suiteId: 's',
      provider: 'mock/m',
      startedAt: '2026-04-25T00:00:00.000Z',
      completedAt: '2026-04-25T00:00:01.000Z',
      cases: [
        {
          caseId: 'c1',
          runId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          output: 'a',
          score: 1,
          threshold: 0.1,
          latencyMs: 10,
          status: 'pass',
        },
        {
          caseId: 'c2',
          runId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
          output: 'b',
          score: 0.5,
          threshold: 0.1,
          latencyMs: 20,
          status: 'pass',
        },
      ],
      summary: { total: 2, passed: 2 },
    },
    context: {
      suiteHashes: { c1: 'sha256:abc', c2: 'sha256:def' },
      judgeHash: 'sha256:judge',
    },
    ...overrides,
  };
}

// ─── envelope validation ────────────────────────────────────────────────

describe('IngestEnvelopeSchema', () => {
  it('accepts a well-formed envelope', () => {
    expect(IngestEnvelopeSchema.safeParse(makeEnvelope()).success).toBe(true);
  });

  it('rejects wrong schemaVersion', () => {
    const bad = { ...makeEnvelope(), schemaVersion: 2 };
    expect(IngestEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-UUID run id', () => {
    const bad = makeEnvelope();
    bad.run.id = 'not-a-uuid';
    expect(IngestEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a run with a bad ISO timestamp', () => {
    const bad = makeEnvelope();
    bad.run.startedAt = 'yesterday';
    expect(IngestEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts envelopes without a context (snapshots skipped)', () => {
    const ctxless = { ...makeEnvelope(), context: undefined };
    expect(IngestEnvelopeSchema.safeParse(ctxless).success).toBe(true);
  });
});

// ─── ingestRun ──────────────────────────────────────────────────────────

describe('ingestRun', () => {
  it('inserts the run and one snapshot per case with matching suiteHash', async () => {
    const { db, tables } = createFakeDb();
    const out = await ingestRun(db, makeEnvelope());
    expect(out).toMatchObject({
      runInserted: true,
      snapshotsWritten: 2,
      snapshotsSkipped: 0,
    });
    expect(tables.runs.rows).toHaveLength(1);
    expect(tables.baseline_snapshots.rows).toHaveLength(2);
    expect(tables.baseline_snapshots.rows[0]).toMatchObject({
      caseId: 'c1',
      suiteHash: 'sha256:abc',
      judgeHash: 'sha256:judge',
      score: 1,
    });
  });

  it('is idempotent — re-ingesting the same run writes nothing new', async () => {
    const { db } = createFakeDb();
    const env = makeEnvelope();
    const first = await ingestRun(db, env);
    expect(first.runInserted).toBe(true);
    expect(first.snapshotsWritten).toBe(2);

    const second = await ingestRun(db, env);
    expect(second.runInserted).toBe(false);
    expect(second.snapshotsWritten).toBe(0);
    expect(second.snapshotsSkipped).toBe(2);
  });

  it('skips snapshots when the envelope has no context', async () => {
    const { db, tables } = createFakeDb();
    const env = makeEnvelope({ context: undefined });
    const out = await ingestRun(db, env);
    expect(out).toMatchObject({
      runInserted: true,
      snapshotsWritten: 0,
      snapshotsSkipped: 2,
    });
    expect(tables.runs.rows).toHaveLength(1);
    expect(tables.baseline_snapshots.rows).toHaveLength(0);
  });

  it('skips individual cases when the context map is missing an entry', async () => {
    const { db, tables } = createFakeDb();
    const env = makeEnvelope();
    env.context = { suiteHashes: { c1: 'sha256:abc' } }; // c2 absent
    const out = await ingestRun(db, env);
    expect(out.snapshotsWritten).toBe(1);
    expect(out.snapshotsSkipped).toBe(1);
    expect(tables.baseline_snapshots.rows.map((r) => r.caseId)).toEqual(['c1']);
  });

  it('persists null judgeHash when context omits it', async () => {
    const { db, tables } = createFakeDb();
    const env = makeEnvelope();
    env.context = { suiteHashes: { c1: 'sha256:abc' } };
    await ingestRun(db, env);
    expect(tables.baseline_snapshots.rows[0].judgeHash).toBeNull();
  });
});
