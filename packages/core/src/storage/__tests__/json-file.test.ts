import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { JsonFileStorage } from '../json-file.js';
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

describe('JsonFileStorage', () => {
  let dir: string;
  let storage: JsonFileStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drift-runs-'));
    storage = new JsonFileStorage(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
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
    await storage.saveRun(makeRun({ id: 'old', startedAt: new Date('2020-01-01') }));
    await storage.saveRun(makeRun({ id: 'new', startedAt: new Date('2030-01-01') }));
    const most = await storage.getMostRecentRun();
    expect(most?.id).toBe('new');
  });

  it('getMostRecentRun filters by suiteId', async () => {
    await storage.saveRun(makeRun({ id: 'a', suiteId: 's1', startedAt: new Date('2030-01-01') }));
    await storage.saveRun(makeRun({ id: 'b', suiteId: 's2', startedAt: new Date('2031-01-01') }));
    const s1 = await storage.getMostRecentRun('s1');
    expect(s1?.id).toBe('a');
  });

  it('listRuns respects limit', async () => {
    await storage.saveRun(makeRun({ id: 'a', startedAt: new Date('2020-01-01') }));
    await storage.saveRun(makeRun({ id: 'b', startedAt: new Date('2021-01-01') }));
    await storage.saveRun(makeRun({ id: 'c', startedAt: new Date('2022-01-01') }));
    const list = await storage.listRuns({ limit: 2 });
    expect(list.map((r) => r.id)).toEqual(['c', 'b']);
  });

  it('returns empty list when directory does not exist', async () => {
    const fresh = new JsonFileStorage(join(dir, 'does-not-exist'));
    expect(await fresh.listRuns()).toEqual([]);
    expect(await fresh.getMostRecentRun()).toBeNull();
  });

  it('saveRun overwrites an existing run with the same id', async () => {
    await storage.saveRun(makeRun({ id: 'r1', provider: 'mock' }));
    await storage.saveRun(makeRun({ id: 'r1', provider: 'anthropic' }));
    const loaded = await storage.getRun('r1');
    expect(loaded!.provider).toBe('anthropic');
  });
});
