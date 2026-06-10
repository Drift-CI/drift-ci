import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';

import {
  buildPayload,
  JSON_REPORTER_SCHEMA_VERSION,
  JsonReporter,
} from '../json.js';
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
  return {
    suite: {
      version: 1,
      id: 'suite-1',
      name: 'Test Suite',
      cases: [{ id: 'case-a', input: 'hello', expected: 'world' }],
    } as unknown as RunEndContext['suite'],
    run: {
      id: 'run-42',
      suiteId: 'suite-1',
      provider: 'mock/test',
      startedAt: new Date('2026-04-22T10:00:00Z'),
      completedAt: new Date('2026-04-22T10:00:01Z'),
      cases: [
        {
          caseId: 'case-a',
          runId: 'run-42',
          output: 'world',
          score: 0.875,
          threshold: 0.1,
          latencyMs: 40,
          status: 'pass',
        },
        {
          caseId: 'case-b',
          runId: 'run-42',
          output: null,
          score: NaN,
          threshold: 0.1,
          latencyMs: 12,
          status: 'evaluator-error',
          error: 'schema missing',
        },
      ],
      summary: {
        total: 2,
        passed: 1,
        transient: 0,
        evaluatorErrors: 1,
        failed: 0,
        regressions: 0,
        avgScore: 0.875,
        avgLatencyMs: 26,
      },
    },
    deltas: null,
    loaded: {
      config: {} as never,
      requestedVersion: { major: 1, minor: 0 },
      upgradedInMemory: false,
    },
    ...overrides,
  };
}

describe('JsonReporter', () => {
  it('emits a single JSON document to the stream', () => {
    const stream = new CollectingStream();
    const reporter = new JsonReporter({ out: stream });
    reporter.onRunEnd(makeCtx());
    const parsed = JSON.parse(stream.written);
    expect(parsed.schemaVersion).toBe(JSON_REPORTER_SCHEMA_VERSION);
    expect(parsed.run.id).toBe('run-42');
    expect(parsed.run.provider).toBe('mock/test');
    expect(parsed.suite).toEqual({ id: 'suite-1', name: 'Test Suite' });
  });

  it('serialises NaN scores as null (JSON has no NaN)', () => {
    const payload = buildPayload(makeCtx());
    const serialisedCases = payload.run.cases as Array<{
      caseId: string;
      score: number | null;
    }>;
    const caseB = serialisedCases.find((c) => c.caseId === 'case-b');
    expect(caseB?.score).toBeNull();
  });

  it('includes deltas when present', () => {
    const payload = buildPayload(
      makeCtx({
        deltas: {
          deltas: { 'case-a': -0.2 },
          regressions: ['case-a'],
          improvements: [],
          missingBaselines: [],
          staleBaselines: [],
          staleJudges: [],
          noScore: [],
        },
      }),
    );
    expect(payload.deltas).toMatchObject({
      regressions: ['case-a'],
      deltas: { 'case-a': -0.2 },
    });
  });

  it('records requestedVersion and upgradedInMemory', () => {
    const payload = buildPayload(
      makeCtx({
        loaded: {
          config: {} as never,
          requestedVersion: { major: 1, minor: 0 },
          upgradedInMemory: true,
        },
      }),
    );
    expect(payload.config).toEqual({
      upgradedInMemory: true,
      requestedVersion: '1.0',
    });
  });

  it('ISO-serialises run timestamps', () => {
    const payload = buildPayload(makeCtx());
    expect(payload.run.startedAt).toBe('2026-04-22T10:00:00.000Z');
    expect(payload.run.completedAt).toBe('2026-04-22T10:00:01.000Z');
  });
});
