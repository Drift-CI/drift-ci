import { describe, it, expect } from 'vitest';
import { Runner, RUN_ABORTED_TRANSIENT } from '../runner.js';
import { MockProvider } from '../../providers/mock.js';
import { EvaluatorChain } from '../../evaluators/composite.js';
import { ExactMatchEvaluator } from '../../evaluators/exact.js';
import { MemoryStorage } from '../../storage/memory.js';
import type { Suite } from '../../types/index.js';

function makeSuite(overrides: Partial<Suite> = {}): Suite {
  return {
    version: 1,
    id: 'test-suite',
    name: 'Test',
    cases: [
      { id: 'c1', input: 'hi', expected: 'hi' },
      { id: 'c2', input: 'bye', expected: 'bye' },
    ],
    ...overrides,
  };
}

function chainOf(...evs: InstanceType<typeof ExactMatchEvaluator>[]) {
  const share = 1 / evs.length;
  return new EvaluatorChain(evs.map((e) => ({ evaluator: e, weight: share })));
}

describe('Runner', () => {
  it('runs every case end-to-end on the happy path', async () => {
    const provider = new MockProvider({
      responses: { hi: 'hi', bye: 'bye' },
      defaultResponse: 'fallback',
    });
    const storage = new MemoryStorage();
    const runner = new Runner({
      provider,
      evaluator: chainOf(new ExactMatchEvaluator()),
      storage,
    });

    const result = await runner.run(makeSuite());

    expect(result.summary.total).toBe(2);
    expect(result.summary.passed).toBe(2);
    expect(result.summary.avgScore).toBe(1);
    expect(result.cases.every((c) => c.status === 'pass')).toBe(true);
    expect(await storage.getRun(result.id)).not.toBeNull();
  });

  it('marks rate-limit errors as provider-rate-limit and keeps NaN score', async () => {
    const provider = new MockProvider({
      responder: () => {
        const e = new Error('rate limit exceeded') as Error & {
          status: number;
        };
        e.status = 429;
        return e;
      },
    });
    // 2-case suite: floor(2 * 0.2) = 0, so threshold = max(3, 0) = 3.
    // Both cases will hit 429 but that's 2 transient — below the floor.
    const runner = new Runner({
      provider,
      evaluator: chainOf(new ExactMatchEvaluator()),
      storage: new MemoryStorage(),
    });

    const result = await runner.run(makeSuite());
    expect(result.summary.transient).toBe(2);
    expect(result.summary.regressions).toBe(0);
    expect(result.cases.every((c) => c.status === 'provider-rate-limit')).toBe(
      true,
    );
    expect(result.cases.every((c) => Number.isNaN(c.score))).toBe(true);
  });

  it('aborts with RUN_ABORTED_TRANSIENT when transient failures exceed the threshold', async () => {
    const cases = Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      input: `q${i}`,
      expected: `a${i}`,
    }));
    const provider = new MockProvider({
      responder: () => {
        const e = new Error('rate limit') as Error & { status: number };
        e.status = 429;
        return e;
      },
    });
    const runner = new Runner({
      provider,
      evaluator: chainOf(new ExactMatchEvaluator()),
      storage: new MemoryStorage(),
    });

    await expect(
      runner.run({
        version: 1,
        id: 's',
        name: 'Big',
        cases,
      }),
    ).rejects.toMatchObject({ code: RUN_ABORTED_TRANSIENT });
  });

  it('treats an evaluator throw as evaluator-error, not a regression', async () => {
    const provider = new MockProvider({ defaultResponse: 'out' });
    // expected is omitted, so exact-match will throw.
    const runner = new Runner({
      provider,
      evaluator: chainOf(new ExactMatchEvaluator()),
      storage: new MemoryStorage(),
    });
    const suite: Suite = {
      version: 1,
      id: 's',
      name: 'N',
      cases: [{ id: 'only', input: 'q' }],
    };

    const result = await runner.run(suite);
    expect(result.summary.evaluatorErrors).toBe(1);
    expect(result.summary.passed).toBe(0);
    expect(Number.isNaN(result.cases[0].score)).toBe(true);
    expect(result.cases[0].status).toBe('evaluator-error');
  });

  it('invokes onCaseComplete once per case before run() resolves', async () => {
    const provider = new MockProvider({ defaultResponse: 'hi' });
    const seen: string[] = [];
    const runner = new Runner({
      provider,
      evaluator: chainOf(new ExactMatchEvaluator()),
      storage: new MemoryStorage(),
      onCaseComplete: (r) => seen.push(r.caseId),
    });
    const suite = makeSuite({
      cases: [
        { id: 'a', input: 'hi', expected: 'hi' },
        { id: 'b', input: 'hi', expected: 'hi' },
        { id: 'c', input: 'hi', expected: 'hi' },
      ],
    });
    const result = await runner.run(suite);
    expect(seen.length).toBe(3);
    expect(new Set(seen)).toEqual(new Set(['a', 'b', 'c']));
    expect(result.cases.length).toBe(3);
  });

  it('carries per-case threshold through the resolved threshold field', async () => {
    const provider = new MockProvider({ defaultResponse: 'hi' });
    const runner = new Runner({
      provider,
      evaluator: chainOf(new ExactMatchEvaluator()),
      storage: new MemoryStorage(),
      defaultThreshold: 0.2,
    });
    const suite: Suite = {
      version: 1,
      id: 's',
      name: 'N',
      default_threshold: 0.15,
      cases: [
        { id: 'a', input: 'hi', expected: 'hi' },
        { id: 'b', input: 'hi', expected: 'hi', threshold: 0.05 },
      ],
    };

    const result = await runner.run(suite);
    const byId = Object.fromEntries(result.cases.map((c) => [c.caseId, c]));
    expect(byId.a.threshold).toBe(0.2);
    expect(byId.b.threshold).toBe(0.05);
  });
});
