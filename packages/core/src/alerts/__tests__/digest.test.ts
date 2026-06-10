import { describe, it, expect } from 'vitest';

import {
  buildDigestPayload,
  summariseDigest,
  type DigestRun,
} from '../digest.js';
import type { DeltaReport } from '../../engine/baseline.js';
import type { RunResult } from '../../types/result.js';

const W_START = new Date('2026-04-18T00:00:00Z');
const W_END = new Date('2026-04-25T00:00:00Z');

function run(
  id: string,
  suiteId = 'suite-a',
  provider = 'anthropic/claude-sonnet-4-5',
  cases: RunResult['cases'] = [],
  avgScore = 0.5,
): RunResult {
  return {
    id,
    suiteId,
    provider,
    startedAt: new Date('2026-04-22T00:00:00Z'),
    completedAt: new Date('2026-04-22T00:01:00Z'),
    cases,
    summary: {
      total: cases.length,
      passed: 0,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore,
      avgLatencyMs: 100,
    },
  };
}

function caseRes(caseId: string, score: number): RunResult['cases'][number] {
  return { caseId, runId: 'irrelevant', output: '', score, threshold: 0.1, latencyMs: 100, status: 'pass' };
}

function delta(
  cases: Record<string, number>,
  regressions: string[] = [],
  extras: Partial<DeltaReport> = {},
): DeltaReport {
  return {
    deltas: cases,
    regressions,
    improvements: [],
    missingBaselines: [],
    staleBaselines: [],
    staleJudges: [],
    noScore: [],
    ...extras,
  };
}

// ─── summariseDigest ────────────────────────────────────────────────────

describe('summariseDigest', () => {
  it('returns empty stats for an empty window', () => {
    const s = summariseDigest([]);
    expect(s).toEqual({
      totalRuns: 0,
      regressingRuns: 0,
      suites: [],
      providers: [],
      avgScore: 0,
      totalRegressions: 0,
      topRegressions: [],
    });
  });

  it('counts regressions across runs and identifies which runs had them', () => {
    const digestRuns: DigestRun[] = [
      {
        run: run('run-1', 'suite-a', 'p', [caseRes('a', 0.4), caseRes('b', 0.7)], 0.55),
        deltas: delta({ a: -0.4, b: -0.05 }, ['a']),
      },
      {
        run: run('run-2', 'suite-a', 'p', [caseRes('a', 0.9), caseRes('c', 0.8)], 0.85),
        deltas: delta({ a: 0.0, c: 0.0 }), // no regressions
      },
      {
        run: run('run-3', 'suite-a', 'p', [caseRes('d', 0.3)], 0.30),
        deltas: delta({ d: -0.6 }, ['d']),
      },
    ];
    const s = summariseDigest(digestRuns);
    expect(s.totalRuns).toBe(3);
    expect(s.regressingRuns).toBe(2); // run-1 + run-3
    expect(s.totalRegressions).toBe(2);
  });

  it('sorts topRegressions worst-first (most-negative delta)', () => {
    const digestRuns: DigestRun[] = [
      {
        run: run('run-1', 'suite-a', 'p', [caseRes('a', 0.5), caseRes('b', 0.4)], 0.45),
        deltas: delta({ a: -0.2, b: -0.6 }, ['a', 'b']),
      },
      {
        run: run('run-2', 'suite-a', 'p', [caseRes('c', 0.7)], 0.7),
        deltas: delta({ c: -0.3 }, ['c']),
      },
    ];
    const s = summariseDigest(digestRuns);
    expect(s.topRegressions.map((r) => r.caseId)).toEqual(['b', 'c', 'a']);
  });

  it('caps topRegressions at topN', () => {
    const cases = Array.from({ length: 50 }, (_, i) => caseRes(`case-${i}`, 0.5));
    const deltas: Record<string, number> = {};
    const regressionIds: string[] = [];
    for (let i = 0; i < 50; i++) {
      deltas[`case-${i}`] = -0.5 - i * 0.001; // descending so order is stable
      regressionIds.push(`case-${i}`);
    }
    const digestRuns: DigestRun[] = [
      { run: run('run-1', 'suite-a', 'p', cases, 0.5), deltas: delta(deltas, regressionIds) },
    ];
    const s = summariseDigest(digestRuns, 5);
    expect(s.topRegressions).toHaveLength(5);
    expect(s.topRegressions.map((r) => r.caseId)).toEqual([
      'case-49',
      'case-48',
      'case-47',
      'case-46',
      'case-45',
    ]);
  });

  it('excludes noScore / missingBaselines / staleBaselines from the digest', () => {
    const digestRuns: DigestRun[] = [
      {
        run: run('run-1', 'suite-a', 'p', [
          caseRes('nan-case', NaN),
          caseRes('first-time', 0.9),
          caseRes('stale', 0.5),
          caseRes('legit', 0.3),
        ]),
        deltas: delta(
          { 'legit': -0.4 },
          ['legit'],
          {
            noScore: ['nan-case'],
            missingBaselines: ['first-time'],
            staleBaselines: ['stale'],
          },
        ),
      },
    ];
    const s = summariseDigest(digestRuns);
    expect(s.topRegressions.map((r) => r.caseId)).toEqual(['legit']);
    expect(s.totalRegressions).toBe(1);
  });

  it('collects distinct suites and providers, sorted', () => {
    const digestRuns: DigestRun[] = [
      { run: run('1', 'suite-b', 'openai/gpt-4'), deltas: delta({}) },
      { run: run('2', 'suite-a', 'anthropic/x'), deltas: delta({}) },
      { run: run('3', 'suite-a', 'anthropic/x'), deltas: delta({}) },
    ];
    const s = summariseDigest(digestRuns);
    expect(s.suites).toEqual(['suite-a', 'suite-b']);
    expect(s.providers).toEqual(['anthropic/x', 'openai/gpt-4']);
  });

  it('computes mean avgScore across all runs', () => {
    const digestRuns: DigestRun[] = [
      { run: run('1', 'suite-a', 'p', [], 0.4), deltas: delta({}) },
      { run: run('2', 'suite-a', 'p', [], 0.6), deltas: delta({}) },
      { run: run('3', 'suite-a', 'p', [], 0.8), deltas: delta({}) },
    ];
    const s = summariseDigest(digestRuns);
    expect(s.avgScore).toBeCloseTo(0.6, 5);
  });

  it('skips cases without a delta entry (defensive against malformed input)', () => {
    const digestRuns: DigestRun[] = [
      {
        run: run('run-1', 'suite-a', 'p', [caseRes('a', 0.5)]),
        deltas: delta({}, []), // no entries at all
      },
    ];
    const s = summariseDigest(digestRuns);
    expect(s.topRegressions).toEqual([]);
  });
});

// ─── buildDigestPayload ─────────────────────────────────────────────────

describe('buildDigestPayload', () => {
  const baseOpts = {
    ruleId: 'digest-rule',
    ruleName: 'Weekly digest',
    windowStart: W_START,
    windowEnd: W_END,
    now: new Date('2026-04-25T01:00:00Z'),
  };

  it('returns version 1 + ruleId/ruleName from options', () => {
    const p = buildDigestPayload([], baseOpts);
    expect(p.version).toBe(1);
    expect(p.ruleId).toBe('digest-rule');
    expect(p.ruleName).toBe('Weekly digest');
  });

  it('handles an empty window without throwing', () => {
    const p = buildDigestPayload([], baseOpts);
    expect(p.regressions).toEqual([]);
    expect(p.reason).toMatch(/0 runs/);
    expect(p.runId).toBe('digest-no-runs');
  });

  it('builds a reason sentence with run-count, regression-count, and avg score', () => {
    const digestRuns: DigestRun[] = [
      {
        run: run('1', 'suite-a', 'p', [caseRes('a', 0.4)], 0.4),
        deltas: delta({ a: -0.5 }, ['a']),
      },
      {
        run: run('2', 'suite-a', 'p', [caseRes('a', 0.6)], 0.6),
        deltas: delta({ a: 0.0 }),
      },
    ];
    const p = buildDigestPayload(digestRuns, baseOpts);
    expect(p.reason).toMatch(/2 runs/);
    expect(p.reason).toMatch(/1 regression\(s\)/);
    expect(p.reason).toMatch(/Avg score 0\.500/);
  });

  it('uses worst-regression source as the anchor runId', () => {
    const digestRuns: DigestRun[] = [
      {
        run: run('run-light', 'suite-a', 'p', [caseRes('a', 0.4)], 0.4),
        deltas: delta({ a: -0.1 }, ['a']),
      },
      {
        run: run('run-heavy', 'suite-a', 'p', [caseRes('b', 0.2)], 0.2),
        deltas: delta({ b: -0.7 }, ['b']),
      },
    ];
    const p = buildDigestPayload(digestRuns, baseOpts);
    // worst delta is run-heavy (-0.7), so the anchor is run-heavy.
    expect(p.runId).toBe('run-heavy');
  });

  it('falls back to the latest run when no regressions exist', () => {
    const digestRuns: DigestRun[] = [
      { run: run('first'), deltas: delta({}) },
      { run: run('latest'), deltas: delta({}) },
    ];
    const p = buildDigestPayload(digestRuns, baseOpts);
    expect(p.runId).toBe('latest');
  });

  it('renders runUrl via the supplied builder', () => {
    const digestRuns: DigestRun[] = [
      {
        run: run('run-x', 'suite-a', 'p', [caseRes('a', 0.2)], 0.2),
        deltas: delta({ a: -0.6 }, ['a']),
      },
    ];
    const p = buildDigestPayload(digestRuns, {
      ...baseOpts,
      runUrlBuilder: (r) => `https://drift.example.com/runs/${r.id}`,
    });
    expect(p.runUrl).toBe('https://drift.example.com/runs/run-x');
  });

  it('reports a single suite name when the window covers one suite', () => {
    const p = buildDigestPayload(
      [{ run: run('1', 'suite-only'), deltas: delta({}) }],
      baseOpts,
    );
    expect(p.suiteId).toBe('suite-only');
  });

  it('reports an aggregate label when the window spans multiple suites', () => {
    const p = buildDigestPayload(
      [
        { run: run('1', 'suite-a'), deltas: delta({}) },
        { run: run('2', 'suite-b'), deltas: delta({}) },
      ],
      baseOpts,
    );
    expect(p.suiteId).toBe('2 suites');
  });

  it('mirrors the same single/aggregate behaviour for provider', () => {
    const p = buildDigestPayload(
      [
        { run: run('1', 'suite-a', 'openai/gpt-4'), deltas: delta({}) },
        { run: run('2', 'suite-a', 'anthropic/sonnet'), deltas: delta({}) },
      ],
      baseOpts,
    );
    expect(p.provider).toBe('2 providers');
  });

  it('caps regressions in the payload at topN', () => {
    const cases = Array.from({ length: 30 }, (_, i) => caseRes(`c-${i}`, 0.5));
    const deltas: Record<string, number> = {};
    const regressionIds: string[] = [];
    for (let i = 0; i < 30; i++) {
      deltas[`c-${i}`] = -0.5 - i * 0.001;
      regressionIds.push(`c-${i}`);
    }
    const p = buildDigestPayload(
      [{ run: run('1', 'suite-a', 'p', cases, 0.5), deltas: delta(deltas, regressionIds) }],
      { ...baseOpts, topN: 5 },
    );
    expect(p.regressions).toHaveLength(5);
  });

  it('uses windowStart for startedAt and `now` for firedAt', () => {
    const p = buildDigestPayload([], baseOpts);
    expect(p.startedAt).toEqual(W_START);
    expect(p.firedAt).toEqual(baseOpts.now);
  });
});
