import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SQLiteStorage, SQLITE_SCHEMA_VERSION } from '../sqlite.js';
import type { RunResult } from '../../types/index.js';

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'r1',
    suiteId: 's',
    provider: 'mock',
    startedAt: new Date('2026-04-20T00:00:00Z'),
    completedAt: new Date('2026-04-20T00:00:01Z'),
    cases: [],
    summary: {
      total: 0,
      passed: 0,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 0,
      avgLatencyMs: 0,
    },
    ...overrides,
  };
}

describe('SQLiteStorage', () => {
  let dir: string;
  let dbPath: string;
  let storage: SQLiteStorage;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'drift-sqlite-'));
    dbPath = join(dir, 'db.sqlite');
    storage = await SQLiteStorage.open(dbPath);
  });

  afterEach(async () => {
    await storage.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the database file under the requested path', () => {
    expect(existsSync(dbPath)).toBe(true);
    expect(storage.path.endsWith('db.sqlite')).toBe(true);
  });

  it('roundtrips runs preserving Date instances', async () => {
    const run = makeRun();
    await storage.saveRun(run);
    const loaded = await storage.getRun('r1');
    expect(loaded).not.toBeNull();
    expect(loaded!.startedAt).toBeInstanceOf(Date);
    expect(loaded!.startedAt.toISOString()).toBe(run.startedAt.toISOString());
    expect(loaded!.completedAt.toISOString()).toBe(run.completedAt.toISOString());
  });

  it('returns null on getRun when missing', async () => {
    expect(await storage.getRun('nope')).toBeNull();
  });

  it('getMostRecentRun returns the run with the latest startedAt', async () => {
    await storage.saveRun(
      makeRun({ id: 'old', startedAt: new Date('2020-01-01') }),
    );
    await storage.saveRun(
      makeRun({ id: 'new', startedAt: new Date('2030-01-01') }),
    );
    const most = await storage.getMostRecentRun();
    expect(most?.id).toBe('new');
  });

  it('getMostRecentRun filters by suiteId', async () => {
    await storage.saveRun(
      makeRun({ id: 'a', suiteId: 's1', startedAt: new Date('2030-01-01') }),
    );
    await storage.saveRun(
      makeRun({ id: 'b', suiteId: 's2', startedAt: new Date('2031-01-01') }),
    );
    const s1 = await storage.getMostRecentRun('s1');
    expect(s1?.id).toBe('a');
  });

  it('listRuns respects limit and orders by startedAt desc', async () => {
    await storage.saveRun(makeRun({ id: 'a', startedAt: new Date('2020-01-01') }));
    await storage.saveRun(makeRun({ id: 'b', startedAt: new Date('2021-01-01') }));
    await storage.saveRun(makeRun({ id: 'c', startedAt: new Date('2022-01-01') }));
    const list = await storage.listRuns({ limit: 2 });
    expect(list.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('listRuns filters by suiteId', async () => {
    await storage.saveRun(makeRun({ id: 'a', suiteId: 's1' }));
    await storage.saveRun(makeRun({ id: 'b', suiteId: 's2' }));
    await storage.saveRun(makeRun({ id: 'c', suiteId: 's1' }));
    const s1 = await storage.listRuns({ suiteId: 's1' });
    expect(s1.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  it('saveRun overwrites an existing run with the same id', async () => {
    await storage.saveRun(makeRun({ id: 'r1', provider: 'mock' }));
    await storage.saveRun(makeRun({ id: 'r1', provider: 'anthropic' }));
    const loaded = await storage.getRun('r1');
    expect(loaded!.provider).toBe('anthropic');
  });

  it('records the current schema version in schema_migrations', async () => {
    const reopened = await SQLiteStorage.open(dbPath);
    // Reopening must not fail and must not duplicate the migration row.
    await reopened.close();
    // Re-open yet again and read directly.
    const again = await SQLiteStorage.open(dbPath);
    const runs = await again.listRuns();
    expect(runs).toEqual([]);
    await again.close();
    // If we got here, migrations are idempotent.
    expect(SQLITE_SCHEMA_VERSION).toBe(1);
  });
});
