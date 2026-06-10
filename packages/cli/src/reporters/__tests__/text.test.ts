import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';

import { TextReporter } from '../text.js';
import type { RunEndContext } from '../interface.js';

class CollectingStream extends PassThrough {
  written = '';
  constructor() {
    super();
    this.on('data', (chunk) => {
      this.written += chunk.toString();
    });
  }
}

function makeCtx(overrides: Partial<RunEndContext> = {}): RunEndContext {
  const run = {
    id: 'run-1',
    suiteId: 'suite-1',
    provider: 'mock/test',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    completedAt: new Date('2026-01-01T00:00:02Z'),
    cases: [
      {
        caseId: 'case-a',
        runId: 'run-1',
        output: 'ok',
        score: 0.9,
        threshold: 0.1,
        latencyMs: 50,
        status: 'pass' as const,
      },
      {
        caseId: 'case-b',
        runId: 'run-1',
        output: null,
        score: NaN,
        threshold: 0.1,
        latencyMs: 120,
        status: 'evaluator-error' as const,
        error: 'boom',
      },
    ],
    summary: {
      total: 2,
      passed: 1,
      transient: 0,
      evaluatorErrors: 1,
      failed: 0,
      regressions: 0,
      avgScore: 0.9,
      avgLatencyMs: 85,
    },
  };
  return {
    suite: {
      version: 1,
      id: 'suite-1',
      name: 'Test Suite',
      cases: [
        { id: 'case-a', input: 'a', expected: 'a' },
        { id: 'case-b', input: 'b', expected: 'b' },
      ],
    } as unknown as RunEndContext['suite'],
    run,
    deltas: null,
    loaded: {
      config: {} as never,
      requestedVersion: { major: 1, minor: 0 },
      upgradedInMemory: false,
    },
    ...overrides,
  };
}

describe('TextReporter', () => {
  it('renders summary with per-case lines', () => {
    const stream = new CollectingStream();
    const reporter = new TextReporter({ out: stream });
    reporter.onRunEnd(makeCtx());
    expect(stream.written).toContain('Suite:    Test Suite (suite-1)');
    expect(stream.written).toContain('Provider: mock/test');
    expect(stream.written).toContain('Cases:    1/2 passed');
    expect(stream.written).toContain('case-a');
    expect(stream.written).toMatch(/case-a\s+pass\s+score=0\.900/);
    expect(stream.written).toMatch(/case-b\s+evaluator-error\s+score=—/);
  });

  it('prints auto-upgrade notice when loader flagged in-memory upgrade', () => {
    const stream = new CollectingStream();
    const reporter = new TextReporter({ out: stream });
    reporter.onRunEnd(
      makeCtx({
        loaded: {
          config: {} as never,
          requestedVersion: { major: 1, minor: 0 },
          upgradedInMemory: true,
        },
      }),
    );
    expect(stream.written).toContain('auto-upgraded in memory');
  });

  it('flags regressions, stale-suite, stale-judge, no-baseline, no-score', () => {
    const stream = new CollectingStream();
    const reporter = new TextReporter({ out: stream });
    reporter.onRunEnd(
      makeCtx({
        deltas: {
          deltas: { 'case-a': -0.2, 'case-b': 0 },
          regressions: ['case-a'],
          improvements: [],
          missingBaselines: [],
          staleBaselines: ['case-a'],
          staleJudges: ['case-a'],
          noScore: ['case-b'],
        },
      }),
    );
    expect(stream.written).toContain('REGRESSION');
    expect(stream.written).toContain('stale-suite');
    expect(stream.written).toContain('stale-judge');
    expect(stream.written).toContain('no-score');
    expect(stream.written).toContain('1 regression(s) detected');
    expect(stream.written).toContain('baseline(s) are stale');
    expect(stream.written).toContain('different judge');
  });

  it('surfaces missing-baseline hint when any case lacks a baseline', () => {
    const stream = new CollectingStream();
    const reporter = new TextReporter({ out: stream });
    reporter.onRunEnd(
      makeCtx({
        deltas: {
          deltas: { 'case-a': 0, 'case-b': 0 },
          regressions: [],
          improvements: [],
          missingBaselines: ['case-a'],
          staleBaselines: [],
          staleJudges: [],
          noScore: [],
        },
      }),
    );
    expect(stream.written).toContain('no baseline yet');
    expect(stream.written).toContain('drift-ci baseline init');
  });

});
