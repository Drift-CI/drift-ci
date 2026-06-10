import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  baselineContentEqual,
  computeDeltas,
  computeJudgeHash,
  computeRubricJudgeHash,
  computeSuiteHash,
  FileBaselineStore,
  OUTPUT_MAX_BYTES,
  serialiseBaseline,
  stableStringify,
  type BaselineEntry,
} from '../baseline.js';
import type { CaseResult, RunResult, Suite, TestCase } from '../../types/index.js';

function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'c1',
    input: 'hello',
    expected: 'hello',
    ...overrides,
  };
}

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'run-1',
    suiteId: 'suite-a',
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

function makeCaseResult(overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: 'c1',
    runId: 'run-1',
    output: 'hello',
    score: 1,
    threshold: 0.1,
    latencyMs: 10,
    status: 'pass',
    ...overrides,
  };
}

describe('stableStringify', () => {
  it('sorts object keys deterministically', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested object keys', () => {
    expect(stableStringify({ a: { z: 1, y: 2 }, b: 3 })).toBe(
      '{"a":{"y":2,"z":1},"b":3}',
    );
  });

  it('preserves array order', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles null and undefined', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
  });
});

describe('computeSuiteHash', () => {
  it('is deterministic for equivalent test cases', () => {
    const a = makeTestCase({ threshold: 0.1 });
    const b = makeTestCase({ threshold: 0.1 });
    expect(computeSuiteHash(a)).toBe(computeSuiteHash(b));
  });

  it('changes when input changes', () => {
    const a = makeTestCase({ input: 'hello' });
    const b = makeTestCase({ input: 'goodbye' });
    expect(computeSuiteHash(a)).not.toBe(computeSuiteHash(b));
  });

  it('changes when expected changes', () => {
    const a = makeTestCase({ expected: 'x' });
    const b = makeTestCase({ expected: 'y' });
    expect(computeSuiteHash(a)).not.toBe(computeSuiteHash(b));
  });

  it('ignores unrelated fields (id, tags, description)', () => {
    const a = makeTestCase({ id: 'alpha', description: 'first' });
    const b = makeTestCase({ id: 'beta', description: 'second' });
    expect(computeSuiteHash(a)).toBe(computeSuiteHash(b));
  });

  it('starts with sha256:', () => {
    expect(computeSuiteHash(makeTestCase())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // ─── M30: rubric invalidates suiteHash (test 25) ─────────────────────

  it('changes when rubric items are reordered (test 25)', () => {
    const a = makeTestCase({
      rubric: [
        { text: 'first', mode: 'lenient' },
        { text: 'second', mode: 'lenient' },
      ],
    });
    const b = makeTestCase({
      rubric: [
        { text: 'second', mode: 'lenient' },
        { text: 'first', mode: 'lenient' },
      ],
    });
    expect(computeSuiteHash(a)).not.toBe(computeSuiteHash(b));
  });

  it('changes when a rubric item mode flips (strict ↔ lenient)', () => {
    const a = makeTestCase({
      rubric: [
        { text: 'first', mode: 'strict' },
        { text: 'second', mode: 'lenient' },
      ],
    });
    const b = makeTestCase({
      rubric: [
        { text: 'first', mode: 'lenient' },
        { text: 'second', mode: 'lenient' },
      ],
    });
    expect(computeSuiteHash(a)).not.toBe(computeSuiteHash(b));
  });

  it('changes when rubricQuorum is added or its threshold flipped', () => {
    const a = makeTestCase({
      rubric: [
        { text: 'first', mode: 'lenient' },
        { text: 'second', mode: 'lenient' },
      ],
    });
    const b = makeTestCase({
      rubric: [
        { text: 'first', mode: 'lenient' },
        { text: 'second', mode: 'lenient' },
      ],
      rubricQuorum: { judges: ['p', 's', 't'], threshold: 'majority', allowSelfBias: false },
    });
    const c = makeTestCase({
      rubric: [
        { text: 'first', mode: 'lenient' },
        { text: 'second', mode: 'lenient' },
      ],
      rubricQuorum: { judges: ['p', 's', 't'], threshold: 'unanimous', allowSelfBias: false },
    });
    expect(computeSuiteHash(a)).not.toBe(computeSuiteHash(b));
    expect(computeSuiteHash(b)).not.toBe(computeSuiteHash(c));
  });
});

describe('computeRubricJudgeHash (M30, test 26)', () => {
  it('is deterministic for the same set + threshold', () => {
    expect(computeRubricJudgeHash(['a', 'b', 'c'], 'majority')).toBe(
      computeRubricJudgeHash(['a', 'b', 'c'], 'majority'),
    );
  });

  it('is order-independent (set identity, not array identity)', () => {
    expect(computeRubricJudgeHash(['c', 'a', 'b'], 'majority')).toBe(
      computeRubricJudgeHash(['a', 'b', 'c'], 'majority'),
    );
  });

  it('changes when any judge in the quorum is swapped', () => {
    const a = computeRubricJudgeHash(['primary', 'secondary', 'tertiary'], 'majority');
    const b = computeRubricJudgeHash(['primary', 'secondary', 'alt'], 'majority');
    expect(a).not.toBe(b);
  });

  it('changes when threshold flips majority ↔ unanimous', () => {
    const a = computeRubricJudgeHash(['a', 'b', 'c'], 'majority');
    const b = computeRubricJudgeHash(['a', 'b', 'c'], 'unanimous');
    expect(a).not.toBe(b);
  });

  it('starts with sha256:', () => {
    expect(computeRubricJudgeHash(['a', 'b'], 'unanimous')).toMatch(
      /^sha256:[0-9a-f]{64}$/,
    );
  });
});

describe('computeJudgeHash', () => {
  it('is deterministic', () => {
    expect(computeJudgeHash('anthropic', 'claude-opus', 'prompt-v1')).toBe(
      computeJudgeHash('anthropic', 'claude-opus', 'prompt-v1'),
    );
  });

  it('changes with any component', () => {
    const base = computeJudgeHash('anthropic', 'opus', 'v1');
    expect(computeJudgeHash('openai', 'opus', 'v1')).not.toBe(base);
    expect(computeJudgeHash('anthropic', 'sonnet', 'v1')).not.toBe(base);
    expect(computeJudgeHash('anthropic', 'opus', 'v2')).not.toBe(base);
  });
});

describe('serialiseBaseline', () => {
  it('puts $schema first and preserves required fields', () => {
    const entry: BaselineEntry = {
      caseId: 'c1',
      suiteId: 's',
      capturedAt: '2026-01-01T00:00:00Z',
      capturedBy: { runId: 'r1', provider: 'mock' },
      suiteHash: 'sha256:abc',
      score: 1,
      output: 'hi',
      outputTruncated: false,
      outputFullHash: 'sha256:def',
    };
    const json = serialiseBaseline(entry);
    const parsed = JSON.parse(json);
    expect(Object.keys(parsed)[0]).toBe('$schema');
    expect(parsed.caseId).toBe('c1');
    expect(parsed.judgeHash).toBeUndefined();
    expect(parsed.redactions).toBeUndefined();
  });

  it('omits empty redactions array', () => {
    const entry: BaselineEntry = {
      caseId: 'c1',
      suiteId: 's',
      capturedAt: '2026-01-01T00:00:00Z',
      capturedBy: { runId: 'r1', provider: 'mock' },
      suiteHash: 'sha256:abc',
      score: 1,
      output: 'hi',
      outputTruncated: false,
      outputFullHash: 'sha256:def',
      redactions: [],
    };
    expect(JSON.parse(serialiseBaseline(entry)).redactions).toBeUndefined();
  });

  it('sorts evaluatorBreakdown keys', () => {
    const entry: BaselineEntry = {
      caseId: 'c1',
      suiteId: 's',
      capturedAt: '2026-01-01T00:00:00Z',
      capturedBy: { runId: 'r1', provider: 'mock' },
      suiteHash: 'sha256:abc',
      score: 1,
      output: 'hi',
      outputTruncated: false,
      outputFullHash: 'sha256:def',
      evaluatorBreakdown: { zebra: 0.5, apple: 1.0 },
    };
    const json = serialiseBaseline(entry);
    const idxA = json.indexOf('"apple"');
    const idxZ = json.indexOf('"zebra"');
    expect(idxA).toBeGreaterThan(-1);
    expect(idxA).toBeLessThan(idxZ);
  });
});

describe('baselineContentEqual', () => {
  const base: BaselineEntry = {
    caseId: 'c1',
    suiteId: 's',
    capturedAt: '2026-01-01T00:00:00Z',
    capturedBy: { runId: 'r1', provider: 'mock' },
    suiteHash: 'sha256:abc',
    score: 1,
    output: 'hi',
    outputTruncated: false,
    outputFullHash: 'sha256:def',
  };

  it('ignores capturedAt and capturedBy', () => {
    const other: BaselineEntry = {
      ...base,
      capturedAt: '2030-01-01T00:00:00Z',
      capturedBy: { runId: 'r2', provider: 'anthropic' },
    };
    expect(baselineContentEqual(base, other)).toBe(true);
  });

  it('flags score difference', () => {
    expect(baselineContentEqual(base, { ...base, score: 0.9 })).toBe(false);
  });

  it('flags suiteHash difference', () => {
    expect(baselineContentEqual(base, { ...base, suiteHash: 'sha256:xyz' })).toBe(
      false,
    );
  });
});

describe('FileBaselineStore', () => {
  let dir: string;
  let store: FileBaselineStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drift-baseline-'));
    store = new FileBaselineStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('roundtrips a baseline entry', async () => {
    const tc = makeTestCase();
    const run = makeRun();
    const cr = makeCaseResult();
    const entry = FileBaselineStore.fromCaseResult(tc, cr, run);
    const saved = await store.save(entry);
    const loaded = await store.load(entry.caseId);
    expect(loaded).not.toBeNull();
    expect(loaded!.score).toBe(saved.score);
    expect(loaded!.output).toBe(saved.output);
    expect(loaded!.outputFullHash).toBe(saved.outputFullHash);
  });

  it('redacts secrets before persisting', async () => {
    const tc = makeTestCase();
    const run = makeRun();
    const cr = makeCaseResult({ output: 'leak AKIAIOSFODNN7EXAMPLE in body' });
    const entry = FileBaselineStore.fromCaseResult(tc, cr, run);
    const saved = await store.save(entry);
    expect(saved.output).toContain('[REDACTED:aws-key]');
    expect(saved.output).not.toContain('AKIA');
    expect(saved.redactions).toEqual([{ kind: 'aws-key', count: 1 }]);

    const onDisk = readFileSync(store.pathFor('c1'), 'utf8');
    expect(onDisk).not.toContain('AKIA');
  });

  it('saveMerged returns unchanged when content is identical', async () => {
    const tc = makeTestCase();
    const run = makeRun();
    const cr = makeCaseResult();
    const entry = FileBaselineStore.fromCaseResult(tc, cr, run);
    const first = await store.saveMerged(entry);
    expect(first).toBe('written');

    const newRun = makeRun({ id: 'run-2', startedAt: new Date('2027-01-01') });
    const entry2 = FileBaselineStore.fromCaseResult(tc, { ...cr, runId: 'run-2' }, newRun);
    const second = await store.saveMerged(entry2);
    expect(second).toBe('unchanged');
  });

  it('saveMerged rewrites when content differs', async () => {
    const tc = makeTestCase();
    const run = makeRun();
    await store.saveMerged(FileBaselineStore.fromCaseResult(tc, makeCaseResult({ score: 1 }), run));
    const result = await store.saveMerged(
      FileBaselineStore.fromCaseResult(tc, makeCaseResult({ score: 0.5 }), run),
    );
    expect(result).toBe('written');
  });

  it('truncates output larger than OUTPUT_MAX_BYTES and sets flag', async () => {
    const tc = makeTestCase();
    const run = makeRun();
    const big = 'x'.repeat(OUTPUT_MAX_BYTES + 500);
    const entry = FileBaselineStore.fromCaseResult(
      tc,
      makeCaseResult({ output: big }),
      run,
    );
    expect(entry.outputTruncated).toBe(true);
    expect(Buffer.byteLength(entry.output, 'utf8')).toBeLessThanOrEqual(OUTPUT_MAX_BYTES);
    expect(entry.outputFullHash).toMatch(/^sha256:/);
  });

  it('loadAll filters by suiteId', async () => {
    const tcA = makeTestCase({ id: 'a' });
    const tcB = makeTestCase({ id: 'b' });
    await store.save(
      FileBaselineStore.fromCaseResult(
        tcA,
        makeCaseResult({ caseId: 'a' }),
        makeRun({ suiteId: 's1' }),
      ),
    );
    await store.save(
      FileBaselineStore.fromCaseResult(
        tcB,
        makeCaseResult({ caseId: 'b' }),
        makeRun({ suiteId: 's2' }),
      ),
    );
    const s1 = await store.loadAll('s1');
    expect(Object.keys(s1)).toEqual(['a']);
    const s2 = await store.loadAll('s2');
    expect(Object.keys(s2)).toEqual(['b']);
  });

  it('deleteCase removes the file and returns true', async () => {
    const tc = makeTestCase();
    await store.save(FileBaselineStore.fromCaseResult(tc, makeCaseResult(), makeRun()));
    expect(existsSync(store.pathFor('c1'))).toBe(true);
    const deleted = await store.deleteCase('c1');
    expect(deleted).toBe(true);
    expect(existsSync(store.pathFor('c1'))).toBe(false);
  });

  it('deleteCase returns false when the file is missing', async () => {
    expect(await store.deleteCase('nope')).toBe(false);
  });
});

describe('computeDeltas', () => {
  let dir: string;
  let store: FileBaselineStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'drift-deltas-'));
    store = new FileBaselineStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function suiteWith(cases: TestCase[], defaultThreshold?: number): Suite {
    return {
      version: 1,
      id: 'suite-a',
      name: 'A',
      default_threshold: defaultThreshold,
      cases,
    };
  }

  it('returns delta=0 and missingBaselines for unseen cases', async () => {
    const suite = suiteWith([makeTestCase({ id: 'c1' })]);
    const run = makeRun({ cases: [makeCaseResult({ caseId: 'c1', score: 0.9 })] });
    const report = await computeDeltas(run, suite, store);
    expect(report.missingBaselines).toEqual(['c1']);
    expect(report.deltas.c1).toBe(0);
    expect(report.regressions).toEqual([]);
  });

  it('reports a regression when score drop exceeds threshold', async () => {
    const tc = makeTestCase({ id: 'c1', threshold: 0.1 });
    const suite = suiteWith([tc]);
    await store.save(
      FileBaselineStore.fromCaseResult(tc, makeCaseResult({ score: 1 }), makeRun()),
    );
    const run = makeRun({
      cases: [makeCaseResult({ caseId: 'c1', score: 0.5, threshold: 0.1 })],
    });
    const report = await computeDeltas(run, suite, store);
    expect(report.regressions).toEqual(['c1']);
    expect(report.deltas.c1).toBeCloseTo(-0.5, 10);
  });

  it('reports an improvement when score gain exceeds threshold', async () => {
    const tc = makeTestCase({ id: 'c1', threshold: 0.1 });
    const suite = suiteWith([tc]);
    await store.save(
      FileBaselineStore.fromCaseResult(tc, makeCaseResult({ score: 0.5 }), makeRun()),
    );
    const run = makeRun({
      cases: [makeCaseResult({ caseId: 'c1', score: 0.9, threshold: 0.1 })],
    });
    const report = await computeDeltas(run, suite, store);
    expect(report.improvements).toEqual(['c1']);
    expect(report.regressions).toEqual([]);
  });

  it('does not flag a regression when suite definition changed (stale baseline)', async () => {
    const oldTc = makeTestCase({ id: 'c1', expected: 'old' });
    const newTc = makeTestCase({ id: 'c1', expected: 'new' });
    await store.save(
      FileBaselineStore.fromCaseResult(oldTc, makeCaseResult({ score: 1 }), makeRun()),
    );
    const suite = suiteWith([newTc]);
    const run = makeRun({
      cases: [makeCaseResult({ caseId: 'c1', score: 0.1, threshold: 0.1 })],
    });
    const report = await computeDeltas(run, suite, store);
    expect(report.staleBaselines).toEqual(['c1']);
    expect(report.regressions).toEqual([]);
  });

  it('flags stale-judge when baseline judgeHash differs from current', async () => {
    const tc = makeTestCase({ id: 'c1' });
    const suite = suiteWith([tc]);
    const entry = FileBaselineStore.fromCaseResult(tc, makeCaseResult(), makeRun(), {
      judgeHash: 'sha256:old-judge',
    });
    await store.save(entry);
    const run = makeRun({
      cases: [makeCaseResult({ caseId: 'c1', score: 1, threshold: 0.1 })],
    });
    const report = await computeDeltas(run, suite, store, {
      judgeHash: 'sha256:new-judge',
    });
    expect(report.staleJudges).toEqual(['c1']);
  });

  it('treats NaN score as noScore, never a regression', async () => {
    const tc = makeTestCase({ id: 'c1' });
    const suite = suiteWith([tc]);
    await store.save(
      FileBaselineStore.fromCaseResult(tc, makeCaseResult({ score: 1 }), makeRun()),
    );
    const run = makeRun({
      cases: [makeCaseResult({ caseId: 'c1', score: NaN, status: 'evaluator-error' })],
    });
    const report = await computeDeltas(run, suite, store);
    expect(report.noScore).toEqual(['c1']);
    expect(report.regressions).toEqual([]);
    expect(report.deltas.c1).toBe(0);
  });

  it('uses default threshold when case has none', async () => {
    const tc = makeTestCase({ id: 'c1' });
    const suite = suiteWith([tc], 0.3);
    await store.save(
      FileBaselineStore.fromCaseResult(tc, makeCaseResult({ score: 1 }), makeRun()),
    );
    const run = makeRun({
      cases: [makeCaseResult({ caseId: 'c1', score: 0.8, threshold: 0.3 })],
    });
    const report = await computeDeltas(run, suite, store);
    expect(report.regressions).toEqual([]);
  });
});
