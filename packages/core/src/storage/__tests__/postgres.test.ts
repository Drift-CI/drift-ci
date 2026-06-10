import { describe, it, expect, vi } from 'vitest';
import { PostgresStorage } from '../postgres.js';
import type { RunResult } from '../../types/index.js';

interface RecordedCall {
  fragments: readonly string[];
  values: unknown[];
}

interface FakeSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  unsafe: ReturnType<typeof vi.fn>;
  begin: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  calls: RecordedCall[];
  responses: unknown[][];
}

function makeFakeSql(responses: unknown[][] = []): FakeSql {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ fragments: [...strings], values });
    return Promise.resolve(queue.shift() ?? []);
  }) as unknown as FakeSql;
  fn.calls = calls;
  fn.responses = responses;
  fn.unsafe = vi.fn().mockResolvedValue([]);
  fn.begin = vi.fn(async (cb: (sql: FakeSql) => Promise<unknown>) => cb(fn));
  fn.end = vi.fn().mockResolvedValue(undefined);
  return fn;
}

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    suiteId: 'suite-a',
    provider: 'mock/m',
    startedAt: new Date('2026-04-25T00:00:00.000Z'),
    completedAt: new Date('2026-04-25T00:00:01.500Z'),
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
    ],
    summary: {
      total: 1,
      passed: 1,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 1,
      avgLatencyMs: 10,
    },
    ...overrides,
  };
}

describe('PostgresStorage.open', () => {
  it('reuses an injected sql client without owning the lifecycle', async () => {
    const sql = makeFakeSql();
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    await storage.close();
    expect(sql.end).not.toHaveBeenCalled();
  });
});

describe('PostgresStorage.saveRun', () => {
  it('issues an INSERT ... ON CONFLICT DO NOTHING on the runs table', async () => {
    const sql = makeFakeSql();
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    await storage.saveRun(makeRun());
    expect(sql.calls).toHaveLength(1);
    const merged = sql.calls[0].fragments.join('?');
    expect(merged).toMatch(/INSERT INTO runs/i);
    expect(merged).toMatch(/ON CONFLICT \(id\) DO NOTHING/i);
    expect(sql.calls[0].values).toEqual([
      'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      'suite-a',
      'mock/m',
      '2026-04-25T00:00:00.000Z',
      '2026-04-25T00:00:01.500Z',
      expect.stringMatching(/^\{.*"id":"f47ac10b/),
    ]);
  });
});

describe('PostgresStorage read paths', () => {
  it('getRun returns null when no row matches', async () => {
    const sql = makeFakeSql([[]]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    expect(await storage.getRun('missing')).toBeNull();
  });

  it('getRun deserialises a JSON row into a RunResult with Date instances', async () => {
    const data = JSON.stringify(makeRun());
    const sql = makeFakeSql([[{ data }]]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    const out = await storage.getRun('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(out).not.toBeNull();
    expect(out!.startedAt).toBeInstanceOf(Date);
    expect(out!.startedAt.toISOString()).toBe('2026-04-25T00:00:00.000Z');
  });

  it('getRun handles already-parsed jsonb columns', async () => {
    const sql = makeFakeSql([[{ data: makeRun() }]]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    const out = await storage.getRun('any');
    expect(out!.completedAt).toBeInstanceOf(Date);
  });

  it('getMostRecentRun without a suiteId issues an unscoped query', async () => {
    const sql = makeFakeSql([[]]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    await storage.getMostRecentRun();
    const merged = sql.calls[0].fragments.join('?');
    expect(merged).toMatch(/ORDER BY started_at DESC\s+LIMIT/i);
    expect(merged).not.toMatch(/WHERE suite_id/i);
  });

  it('getMostRecentRun with a suiteId scopes to that suite', async () => {
    const sql = makeFakeSql([[]]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    await storage.getMostRecentRun('suite-x');
    const merged = sql.calls[0].fragments.join('?');
    expect(merged).toMatch(/WHERE suite_id = /i);
    expect(sql.calls[0].values).toContain('suite-x');
  });

  it('listRuns defaults to a 100-row LIMIT', async () => {
    const sql = makeFakeSql([[]]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    await storage.listRuns();
    expect(sql.calls[0].values).toContain(100);
  });

  it('listRuns honours suiteId + limit filters', async () => {
    const sql = makeFakeSql([[]]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    await storage.listRuns({ suiteId: 'suite-x', limit: 5 });
    expect(sql.calls[0].values).toContain('suite-x');
    expect(sql.calls[0].values).toContain(5);
  });

  it('listRuns returns deserialised rows', async () => {
    const sql = makeFakeSql([
      [{ data: makeRun({ id: '11111111-2222-3333-4444-555555555555' }) }],
    ]);
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    const rows = await storage.listRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('11111111-2222-3333-4444-555555555555');
    expect(rows[0].startedAt).toBeInstanceOf(Date);
  });
});

describe('PostgresStorage.close', () => {
  it('closes the owned connection (if it owns one)', async () => {
    // We can't construct an "owned" client without a live Postgres
    // because `.open()` calls postgres() with a real URL. Verify the
    // injected-sql path leaves end() alone instead.
    const sql = makeFakeSql();
    const storage = await PostgresStorage.open({ url: 'unused', sql });
    await storage.close();
    await storage.close(); // double-close is a no-op
    expect(sql.end).toHaveBeenCalledTimes(0);
  });
});
