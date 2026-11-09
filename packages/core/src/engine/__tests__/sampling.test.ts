import { describe, expect, it } from 'vitest';
import type { CaseResult } from '../../types/index.js';
import {
  aggregateSamples,
  effectiveRuns,
  median,
  sampleCount,
  sumUsage,
} from '../sampling.js';

function sample(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: 'c1',
    runId: 'r1',
    output: 'out',
    score: 1,
    threshold: 0.1,
    latencyMs: 100,
    status: 'pass',
    tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    ...overrides,
  };
}

describe('effectiveRuns', () => {
  it('prefers the case, then the suite default, then 1', () => {
    expect(effectiveRuns(2, 3)).toBe(2);
    expect(effectiveRuns(undefined, 3)).toBe(3);
    expect(effectiveRuns(undefined, undefined)).toBe(1);
    expect(effectiveRuns(1, 5)).toBe(1);
  });
});

describe('median', () => {
  it('returns the middle value for odd counts and the mean of the middle two for even counts', () => {
    expect(median([1, 0, 1])).toBe(1);
    expect(median([0.2, 0.9, 0.5])).toBe(0.5);
    expect(median([0.4, 0.8])).toBeCloseTo(0.6);
    expect(median([3])).toBe(3);
  });

  it('does not mutate its input', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('sumUsage', () => {
  it('sums each field and skips samples without usage', () => {
    expect(
      sumUsage([
        { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        undefined,
        { inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedInputTokens: 4 },
      ]),
    ).toEqual({ inputTokens: 11, outputTokens: 22, totalTokens: 33, cachedInputTokens: 4 });
  });

  it('returns undefined when no sample reported usage and omits cachedInputTokens when none had it', () => {
    expect(sumUsage([undefined, undefined])).toBeUndefined();
    expect(sumUsage([{ inputTokens: 1, outputTokens: 1, totalTokens: 2 }])).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    });
  });
});

describe('aggregateSamples', () => {
  it('returns a single sample unchanged', () => {
    const only = sample({ evaluatorBreakdown: { a: 1 } });
    expect(aggregateSamples([only])).toBe(only);
  });

  it('takes the median and the output of the sample closest to it (one outlier ignored)', () => {
    const r = aggregateSamples([
      sample({ score: 1, output: 'good-1', latencyMs: 90 }),
      sample({ score: 0, output: 'bad' }),
      sample({ score: 1, output: 'good-2' }),
    ]);
    expect(r.score).toBe(1);
    expect(r.status).toBe('pass');
    expect(r.output).toBe('good-1');
    expect(r.latencyMs).toBe(90);
    expect(r.evaluatorBreakdown?.samples).toEqual([
      { score: 1, status: 'pass' },
      { score: 0, status: 'pass' },
      { score: 1, status: 'pass' },
    ]);
  });

  it('keeps the chosen sample breakdown and adds samples', () => {
    const r = aggregateSamples([
      sample({ score: 0.2, evaluatorBreakdown: { judge: 'low' } }),
      sample({ score: 0.5, evaluatorBreakdown: { judge: 'mid' } }),
      sample({ score: 0.9, evaluatorBreakdown: { judge: 'high' } }),
    ]);
    expect(r.score).toBe(0.5);
    expect(r.evaluatorBreakdown).toMatchObject({ judge: 'mid' });
    expect(sampleCount(r)).toBe(3);
  });

  it('sums token usage across every sample, including failed ones', () => {
    const r = aggregateSamples([
      sample(),
      sample({ status: 'provider-network', score: NaN, output: null, tokenUsage: undefined }),
      sample(),
    ]);
    expect(r.tokenUsage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
  });

  it('scores from the successful samples when quorum is met (2 of 3)', () => {
    const r = aggregateSamples([
      sample({ score: 0.4 }),
      sample({ status: 'timeout', score: NaN, output: null, error: 'Timeout' }),
      sample({ score: 0.8 }),
    ]);
    expect(r.status).toBe('pass');
    expect(r.score).toBeCloseTo(0.6);
    expect(r.error).toBeUndefined();
    expect(r.evaluatorBreakdown?.samples).toEqual([
      { score: 0.4, status: 'pass' },
      { score: null, status: 'timeout' },
      { score: 0.8, status: 'pass' },
    ]);
  });

  it('takes the most common failure status when quorum is not met', () => {
    const r = aggregateSamples([
      sample({ status: 'provider-rate-limit', score: NaN, output: null, error: '429 a' }),
      sample({ score: 1 }),
      sample({ status: 'provider-rate-limit', score: NaN, output: null, error: '429 b' }),
    ]);
    expect(r.status).toBe('provider-rate-limit');
    expect(Number.isNaN(r.score)).toBe(true);
    expect(r.error).toBe('429 a');
    expect(r.output).toBeNull();
  });

  it('breaks failure-status ties by first occurrence', () => {
    const r = aggregateSamples([
      sample({ status: 'timeout', score: NaN, output: null, error: 't' }),
      sample({ status: 'evaluator-error', score: NaN, error: 'e' }),
    ]);
    expect(r.status).toBe('timeout');
  });

  it('even sample count with all scored: mean of the middle two', () => {
    const r = aggregateSamples([sample({ score: 0.2 }), sample({ score: 0.6 })]);
    expect(r.score).toBeCloseTo(0.4);
    expect(r.status).toBe('pass');
  });
});

describe('sampleCount', () => {
  it('is 1 for results without samples metadata', () => {
    expect(sampleCount(sample())).toBe(1);
    expect(sampleCount(sample({ evaluatorBreakdown: { samples: 'nope' } }))).toBe(1);
  });
});
