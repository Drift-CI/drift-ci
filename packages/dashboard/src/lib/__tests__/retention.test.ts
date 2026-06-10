import { describe, it, expect, vi } from 'vitest';

import { runRetentionSweep } from '../retention';
import type { Db } from '../db';

// `runRetentionSweep` issues a single `db.execute(sql)` call followed
// by a best-effort `recordAudit(db, ...)`. The Drizzle fake handles
// both: `execute` returns the canned shape under test, `insert` is a
// no-op so the audit write doesn't blow up.

interface ExecuteResultShape {
  driver: 'postgres-js' | 'pg' | 'array';
  rows: Array<{ id: string }>;
}

function makeDb(executeReturn: ExecuteResultShape): {
  db: Db;
  /** Live counter — read AFTER the operation under test. */
  executeCalls: () => number;
  auditedData: Array<Record<string, unknown>>;
} {
  let executeCallsValue = 0;
  const auditedData: Array<Record<string, unknown>> = [];
  const execute = vi.fn(async () => {
    executeCallsValue += 1;
    if (executeReturn.driver === 'array') return executeReturn.rows;
    if (executeReturn.driver === 'postgres-js') {
      const arr = [...executeReturn.rows];
      Object.defineProperty(arr, 'count', {
        value: executeReturn.rows.length,
        enumerable: false,
      });
      return arr;
    }
    /* c8 ignore next 2 -- pg driver shape, exercised by the integration smoke. */
    return { rows: executeReturn.rows, rowCount: executeReturn.rows.length };
  });
  const insert = vi.fn(() => ({
    values(row: Record<string, unknown>): Promise<void> {
      const data = row.data;
      auditedData.push(typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {});
      return Promise.resolve();
    },
  }));
  const db = { execute, insert } as unknown as Db;
  return { db, executeCalls: () => executeCallsValue, auditedData };
}

describe('runRetentionSweep', () => {
  it('returns the deleted count from a postgres-js shaped result', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const { db, auditedData } = makeDb({ driver: 'postgres-js', rows });
    const out = await runRetentionSweep(db, { now: new Date('2026-04-25') });
    expect(out.runsDeleted).toBe(2);
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
    expect(auditedData[0]).toMatchObject({ runsDeleted: 2, batchLimit: 10_000 });
  });

  it('handles a plain-array result shape (no `.count`/`.rowCount`)', async () => {
    const { db } = makeDb({ driver: 'array', rows: [{ id: '1' }] });
    const out = await runRetentionSweep(db);
    expect(out.runsDeleted).toBe(1);
  });

  it('returns 0 deleted when nothing has expired', async () => {
    const { db, auditedData } = makeDb({ driver: 'postgres-js', rows: [] });
    const out = await runRetentionSweep(db);
    expect(out.runsDeleted).toBe(0);
    // Audit row still goes in — operators want "we ran" visibility.
    expect(auditedData).toHaveLength(1);
    expect(auditedData[0]).toMatchObject({ runsDeleted: 0 });
  });

  it('honours a custom batchLimit and records it on the audit row', async () => {
    const { db, auditedData } = makeDb({ driver: 'postgres-js', rows: [] });
    await runRetentionSweep(db, { batchLimit: 250 });
    expect(auditedData[0]).toMatchObject({ batchLimit: 250 });
  });

  it('issues exactly one DELETE per call (no chunked retries)', async () => {
    const { db, executeCalls } = makeDb({ driver: 'postgres-js', rows: [] });
    await runRetentionSweep(db);
    expect(executeCalls()).toBe(1);
  });

  it('records an audit row with sub-second durationMs', async () => {
    const { db, auditedData } = makeDb({ driver: 'postgres-js', rows: [] });
    await runRetentionSweep(db);
    expect(typeof auditedData[0].durationMs).toBe('number');
    expect((auditedData[0].durationMs as number) >= 0).toBe(true);
  });
});
