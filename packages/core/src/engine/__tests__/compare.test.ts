import { describe, it, expect } from 'vitest';

import {
  buildComparison,
  renderComparisonJson,
  renderComparisonTable,
} from '../compare.js';
import type { CaseResult, RunResult, Suite } from '../../types/index.js';

// ─── helpers ────────────────────────────────────────────────────────────

function makeSuite(caseIds: string[]): Suite {
  return {
    version: 1,
    id: 'suite-a',
    name: 'Suite A',
    cases: caseIds.map((id) => ({ id, input: 'q', expected: 'r' })),
  };
}

function makeRun(
  id: string,
  provider: string,
  scoreByCase: Record<string, number | undefined>,
): RunResult {
  const cases: CaseResult[] = Object.entries(scoreByCase)
    .filter(([, score]) => score !== undefined)
    .map(([caseId, score]) => ({
      caseId,
      runId: id,
      output: 'x',
      score: score as number,
      threshold: 0.1,
      latencyMs: 10,
      status: 'pass',
    }));
  const avgScore =
    cases.length > 0
      ? cases.reduce((s, c) => s + c.score, 0) / cases.length
      : 0;
  return {
    id,
    suiteId: 'suite-a',
    provider,
    startedAt: new Date('2026-04-25T11:55:00Z'),
    completedAt: new Date('2026-04-25T11:56:00Z'),
    cases,
    summary: {
      total: cases.length,
      passed: cases.length,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore,
      avgLatencyMs: 10,
    },
  };
}

// ─── buildComparison ───────────────────────────────────────────────────

describe('buildComparison', () => {
  it('throws when fewer than 2 runs are passed', () => {
    const suite = makeSuite(['a', 'b']);
    expect(() =>
      buildComparison([makeRun('r1', 'anthropic/x', { a: 0.8, b: 0.7 })], suite),
    ).toThrow(/at least 2 runs/);
  });

  it('emits one row per case in the suite', () => {
    const suite = makeSuite(['a', 'b', 'c']);
    const runs = [
      makeRun('r1', 'anthropic/x', { a: 0.8, b: 0.7, c: 0.5 }),
      makeRun('r2', 'openai/y', { a: 0.6, b: 0.9, c: 0.5 }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.rows.map((r) => r.caseId)).toEqual(['a', 'b', 'c']);
  });

  it('per-row winner is the strict argmax across providers', () => {
    const suite = makeSuite(['a', 'b']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.8, b: 0.7 }),
      makeRun('r2', 'p2', { a: 0.6, b: 0.9 }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.rows[0].winnerIndex).toBe(0); // p1 wins case a
    expect(report.rows[1].winnerIndex).toBe(1); // p2 wins case b
  });

  it('returns null winnerIndex on a tie', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.8 }),
      makeRun('r2', 'p2', { a: 0.8 }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.rows[0].winnerIndex).toBeNull();
  });

  it('returns null score for a case missing from a provider, and ignores it for the winner', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.4 }),
      makeRun('r2', 'p2', { a: undefined }),
      makeRun('r3', 'p3', { a: 0.7 }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.rows[0].scores).toEqual([0.4, null, 0.7]);
    expect(report.rows[0].winnerIndex).toBe(2);
  });

  it('treats NaN scores as null (no score)', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.5 }),
      makeRun('r2', 'p2', { a: NaN }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.rows[0].scores).toEqual([0.5, null]);
    expect(report.rows[0].winnerIndex).toBe(0);
  });

  it('counts wins per provider in the summary', () => {
    const suite = makeSuite(['a', 'b', 'c', 'd']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.9, b: 0.5, c: 0.5, d: 0.5 }),
      makeRun('r2', 'p2', { a: 0.5, b: 0.9, c: 0.5, d: 0.5 }),
      makeRun('r3', 'p3', { a: 0.5, b: 0.5, c: 0.9, d: 0.5 }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.providers[0].winsCount).toBe(1);
    expect(report.providers[1].winsCount).toBe(1);
    expect(report.providers[2].winsCount).toBe(1);
    // case d is a 3-way tie → no provider gets the win
  });

  it('counts missing cases per provider', () => {
    const suite = makeSuite(['a', 'b', 'c']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.5, b: 0.5, c: 0.5 }),
      makeRun('r2', 'p2', { a: 0.5 /* b, c missing */ }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.providers[0].missingCount).toBe(0);
    expect(report.providers[1].missingCount).toBe(2);
  });

  it('overall winner is the strict argmax of avgScore', () => {
    const suite = makeSuite(['a', 'b']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.5, b: 0.5 }), // avg 0.5
      makeRun('r2', 'p2', { a: 0.9, b: 0.7 }), // avg 0.8
    ];
    const report = buildComparison(runs, suite);
    expect(report.overallWinnerIndex).toBe(1);
  });

  it('overall winner is null on a tie of averages', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.6 }),
      makeRun('r2', 'p2', { a: 0.6 }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.overallWinnerIndex).toBeNull();
  });

  it('preserves provider input order in the summary', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r3', 'third', { a: 0.5 }),
      makeRun('r1', 'first', { a: 0.5 }),
      makeRun('r2', 'second', { a: 0.5 }),
    ];
    const report = buildComparison(runs, suite);
    expect(report.providers.map((p) => p.provider)).toEqual([
      'third',
      'first',
      'second',
    ]);
  });
});

// ─── renderComparisonTable ─────────────────────────────────────────────

describe('renderComparisonTable', () => {
  it('emits a header line with provider columns', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'anthropic/sonnet-4-5', { a: 0.5 }),
      makeRun('r2', 'openai/gpt-4o-mini', { a: 0.6 }),
    ];
    const out = renderComparisonTable(buildComparison(runs, suite), {
      providerColumnWidth: 24,
    });
    expect(out).toContain('Suite: Suite A');
    expect(out).toContain('Case');
    expect(out).toContain('Winner');
    // Both providers' short names appear in headers (column wide enough).
    expect(out).toContain('sonnet-4-5');
    expect(out).toContain('gpt-4o-mini');
  });

  it('truncates over-long provider names with an ellipsis to fit the column', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'anthropic/very-long-model-name-here', { a: 0.5 }),
      makeRun('r2', 'openai/y', { a: 0.5 }),
    ];
    const out = renderComparisonTable(buildComparison(runs, suite));
    expect(out).toContain('…');
  });

  it('renders missing scores as a dash', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.5 }),
      makeRun('r2', 'p2', { a: undefined }),
    ];
    const out = renderComparisonTable(buildComparison(runs, suite));
    expect(out).toContain('—');
  });

  it('shows "tie" in the winner column when scores match', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.5 }),
      makeRun('r2', 'p2', { a: 0.5 }),
    ];
    const out = renderComparisonTable(buildComparison(runs, suite));
    expect(out).toMatch(/tie/);
  });

  it('appends a Wins summary row', () => {
    const suite = makeSuite(['a', 'b']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.9, b: 0.5 }),
      makeRun('r2', 'p2', { a: 0.4, b: 0.6 }),
    ];
    const out = renderComparisonTable(buildComparison(runs, suite));
    expect(out).toMatch(/Wins/);
    expect(out).toMatch(/1\/2/);
  });

  it('appends a Missing row only when at least one provider is missing cases', () => {
    const suiteFull = makeSuite(['a']);
    const fullRuns = [
      makeRun('r1', 'p1', { a: 0.5 }),
      makeRun('r2', 'p2', { a: 0.5 }),
    ];
    const fullOut = renderComparisonTable(buildComparison(fullRuns, suiteFull));
    expect(fullOut).not.toMatch(/Missing/);

    const suitePartial = makeSuite(['a', 'b']);
    const partialRuns = [
      makeRun('r1', 'p1', { a: 0.5, b: 0.5 }),
      makeRun('r2', 'p2', { a: 0.5 }),
    ];
    const partialOut = renderComparisonTable(buildComparison(partialRuns, suitePartial));
    expect(partialOut).toMatch(/Missing/);
  });

  it('opt-in colour wraps the per-row winner in ANSI green', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.4 }),
      makeRun('r2', 'p2', { a: 0.9 }),
    ];
    const colorOut = renderComparisonTable(buildComparison(runs, suite), {
      color: true,
    });
    const plainOut = renderComparisonTable(buildComparison(runs, suite));
    expect(colorOut).toContain('\x1b[32m');
    expect(plainOut).not.toContain('\x1b[32m');
  });
});

// ─── renderComparisonJson ──────────────────────────────────────────────

describe('renderComparisonJson', () => {
  it('round-trips through JSON.parse with the report shape', () => {
    const suite = makeSuite(['a']);
    const runs = [
      makeRun('r1', 'p1', { a: 0.5 }),
      makeRun('r2', 'p2', { a: 0.6 }),
    ];
    const report = buildComparison(runs, suite);
    const parsed = JSON.parse(renderComparisonJson(report));
    expect(parsed.suiteId).toBe('suite-a');
    expect(parsed.providers).toHaveLength(2);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.overallWinnerIndex).toBe(1);
  });
});
