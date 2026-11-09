import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileBaselineStore, computeDeltas } from '../baseline.js';
import { sampleCount } from '../sampling.js';
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
    const storage = new MemoryStorage();
    const runner = new Runner({
      provider,
      evaluator: chainOf(new ExactMatchEvaluator()),
      storage,
    });

    const err = await runner
      .run({ version: 1, id: 's', name: 'Big', cases })
      .catch((e) => e);
    expect(err).toMatchObject({ code: RUN_ABORTED_TRANSIENT });
    expect(err.run.cases).toHaveLength(20);
    expect(err.run.summary.transient).toBe(20);
    expect(err.run.suiteId).toBe('s');
    expect(err.run.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await storage.listRuns()).toHaveLength(0);
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

describe('Runner repeated sampling', () => {
  /** Provider answering from a fixed script, one entry per call (Error = thrown failure). */
  function scripted(script: (string | Error)[]) {
    let i = 0;
    return new MockProvider({ responder: () => script[i++] ?? 'hi' });
  }
  function rateLimit(): Error {
    const e = new Error('rate limit exceeded') as Error & { status: number };
    e.status = 429;
    return e;
  }
  const oneCase = (extra: Partial<Suite['cases'][number]> = {}, suite: Partial<Suite> = {}) =>
    makeSuite({ cases: [{ id: 'c1', input: 'hi', expected: 'hi', ...extra }], ...suite });

  it('N=1 makes one call and adds no samples metadata', async () => {
    let calls = 0;
    const provider = new MockProvider({ responder: () => { calls++; return 'hi'; } });
    const runner = new Runner({ provider, evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
    const run = await runner.run(oneCase());
    expect(calls).toBe(1);
    expect(run.cases[0].evaluatorBreakdown?.samples).toBeUndefined();
    expect(run.cases[0].score).toBe(1);
  });

  it('runs: 3 ignores one bad answer and keeps a matching output', async () => {
    const runner = new Runner({ provider: scripted(['hi', 'nope', 'hi']), evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
    const run = await runner.run(oneCase({ runs: 3 }));
    const c = run.cases[0];
    expect(c.score).toBe(1);
    expect(c.status).toBe('pass');
    expect(c.output).toBe('hi');
    expect(sampleCount(c)).toBe(3);
    expect(c.tokenUsage).toEqual({ inputTokens: 30, outputTokens: 30, totalTokens: 60 });
  });

  it('suite default_runs applies and a case runs: 1 overrides it', async () => {
    let calls = 0;
    const provider = new MockProvider({ responder: () => { calls++; return 'hi'; } });
    const runner = new Runner({ provider, evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
    const run = await runner.run(
      makeSuite({
        default_runs: 3,
        cases: [
          { id: 'c1', input: 'hi', expected: 'hi' },
          { id: 'c2', input: 'hi', expected: 'hi', runs: 1 },
        ],
      }),
    );
    expect(calls).toBe(4);
    expect(sampleCount(run.cases.find((c) => c.caseId === 'c1')!)).toBe(3);
    expect(sampleCount(run.cases.find((c) => c.caseId === 'c2')!)).toBe(1);
  });

  it('one transient sample out of 3 still scores and is not counted as transient', async () => {
    const runner = new Runner({ provider: scripted(['hi', rateLimit(), 'hi']), evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
    const run = await runner.run(oneCase({ runs: 3 }));
    expect(run.cases[0].status).toBe('pass');
    expect(run.cases[0].score).toBe(1);
    expect(run.summary.transient).toBe(0);
    expect(run.summary.passed).toBe(1);
  });

  it('two transient samples out of 3 make the case transient', async () => {
    const runner = new Runner({ provider: scripted([rateLimit(), 'hi', rateLimit()]), evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
    const run = await runner.run(oneCase({ runs: 3 }));
    expect(run.cases[0].status).toBe('provider-rate-limit');
    expect(Number.isNaN(run.cases[0].score)).toBe(true);
    expect(run.summary.transient).toBe(1);
  });

  it('the abort guard counts cases, not samples', async () => {
    // 2 cases x 3 samples, every sample rate-limited: 2 transient cases, below the floor of 3.
    const runner = new Runner({ provider: new MockProvider({ responder: () => rateLimit() }), evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
    const run = await runner.run(makeSuite({ default_runs: 3 }));
    expect(run.summary.transient).toBe(2);
  });

  it('a 1,1,0 sampled run against a baseline of 1 is not a regression', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'drift-sampling-'));
    try {
      const store = new FileBaselineStore(dir);
      const suite = oneCase({ runs: 3 });
      const baselineRunner = new Runner({ provider: scripted(['hi', 'hi', 'hi']), evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
      const baselineRun = await baselineRunner.run(suite);
      await store.save(FileBaselineStore.fromCaseResult(suite.cases[0], baselineRun.cases[0], baselineRun));

      const runner = new Runner({ provider: scripted(['hi', 'nope', 'hi']), evaluator: chainOf(new ExactMatchEvaluator()), storage: new MemoryStorage() });
      const run = await runner.run(suite);
      const report = await computeDeltas(run, suite, store);
      expect(report.regressions).toEqual([]);
      expect(report.deltas.c1).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
