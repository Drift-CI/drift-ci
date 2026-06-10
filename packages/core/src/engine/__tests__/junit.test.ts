import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { renderJUnitXml } from '../junit.js';
import type { CaseResult, RunResult, Suite } from '../../types/index.js';
import type { DeltaReport } from '../baseline.js';

function makeCase(id: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: id,
    runId: 'run-1',
    output: 'out',
    score: 1,
    threshold: 0.1,
    latencyMs: 100,
    status: 'pass',
    ...overrides,
  };
}

function makeRun(cases: CaseResult[]): RunResult {
  return {
    id: 'run-1',
    suiteId: 's',
    provider: 'mock/m',
    startedAt: new Date('2026-04-23T00:00:00.000Z'),
    completedAt: new Date('2026-04-23T00:00:05.500Z'),
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((c) => c.status === 'pass').length,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 1,
      avgLatencyMs: 100,
    },
  };
}

function makeSuite(caseIds: string[]): Suite {
  return {
    version: 1,
    id: 's',
    name: 'Suite Name',
    cases: caseIds.map((id) => ({
      id,
      input: `q-${id}`,
      expected: `a-${id}`,
    })),
  };
}

function emptyDeltas(): DeltaReport {
  return {
    deltas: {},
    regressions: [],
    improvements: [],
    missingBaselines: [],
    staleBaselines: [],
    staleJudges: [],
    noScore: [],
  };
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

describe('renderJUnitXml', () => {
  it('produces well-formed XML with a root testsuites element', () => {
    const xml = renderJUnitXml({
      run: makeRun([makeCase('c1'), makeCase('c2')]),
      suite: makeSuite(['c1', 'c2']),
      deltas: null,
    });
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(() => parser.parse(xml)).not.toThrow();
    const parsed = parser.parse(xml);
    expect(parsed.testsuites.name).toBe('drift-ci');
    expect(Number(parsed.testsuites.tests)).toBe(2);
  });

  it('emits one testsuite with the suite name and matching counts', () => {
    const xml = renderJUnitXml({
      run: makeRun([makeCase('c1'), makeCase('c2')]),
      suite: makeSuite(['c1', 'c2']),
      deltas: null,
    });
    const parsed = parser.parse(xml);
    expect(parsed.testsuites.testsuite.name).toBe('Suite Name');
    expect(Number(parsed.testsuites.testsuite.tests)).toBe(2);
    expect(Number(parsed.testsuites.testsuite.failures)).toBe(0);
    expect(Number(parsed.testsuites.testsuite.errors)).toBe(0);
  });

  it('renders passes as self-closing testcase elements', () => {
    const xml = renderJUnitXml({
      run: makeRun([makeCase('c1')]),
      suite: makeSuite(['c1']),
      deltas: null,
    });
    expect(xml).toMatch(/<testcase classname="s" name="c1" time="0\.100" \/>/);
  });

  it('renders a regression as a <failure type="regression"> child', () => {
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      regressions: ['c1'],
      deltas: { c1: -0.42 },
    };
    const xml = renderJUnitXml({
      run: makeRun([makeCase('c1', { score: 0.58 })]),
      suite: makeSuite(['c1']),
      deltas,
    });
    const parsed = parser.parse(xml);
    const tc = parsed.testsuites.testsuite.testcase;
    expect(tc.failure).toBeDefined();
    expect(tc.failure.type).toBe('regression');
    expect(tc.failure.message).toMatch(/regressed by 0\.420/);
    expect(Number(parsed.testsuites.failures)).toBe(1);
  });

  it('renders evaluator errors as <error type="evaluator-error">', () => {
    const xml = renderJUnitXml({
      run: makeRun([
        makeCase('c1', { status: 'evaluator-error', error: 'schema invalid' }),
      ]),
      suite: makeSuite(['c1']),
      deltas: null,
    });
    const parsed = parser.parse(xml);
    const tc = parsed.testsuites.testsuite.testcase;
    expect(tc.error).toBeDefined();
    expect(tc.error.type).toBe('evaluator-error');
    expect(tc.error.message).toBe('schema invalid');
  });

  it.each([
    ['provider-rate-limit' as const, 'provider-rate-limit'],
    ['provider-network' as const, 'provider-network'],
    ['timeout' as const, 'timeout'],
    ['provider-auth' as const, 'provider-auth'],
  ])('renders %s as <error type="%s">', async (status, expectedType) => {
    const xml = renderJUnitXml({
      run: makeRun([makeCase('c1', { status, error: 'boom' })]),
      suite: makeSuite(['c1']),
      deltas: null,
    });
    const parsed = parser.parse(xml);
    const tc = parsed.testsuites.testsuite.testcase;
    expect(tc.error.type).toBe(expectedType);
  });

  it('counts failures and errors independently', () => {
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      regressions: ['c1'],
      deltas: { c1: -0.5 },
    };
    const xml = renderJUnitXml({
      run: makeRun([
        makeCase('c1', { score: 0.5 }),
        makeCase('c2', { status: 'evaluator-error' }),
        makeCase('c3', { status: 'provider-rate-limit' }),
        makeCase('c4'),
      ]),
      suite: makeSuite(['c1', 'c2', 'c3', 'c4']),
      deltas,
    });
    const parsed = parser.parse(xml);
    expect(Number(parsed.testsuites.tests)).toBe(4);
    expect(Number(parsed.testsuites.failures)).toBe(1);
    expect(Number(parsed.testsuites.errors)).toBe(2);
  });

  it('escapes XML metacharacters in case ids and error messages', () => {
    const xml = renderJUnitXml({
      run: makeRun([
        makeCase('c<1>', {
          status: 'evaluator-error',
          error: 'bad & "weird" < >',
        }),
      ]),
      suite: {
        version: 1,
        id: 's',
        name: 'Suite "A" & <B>',
        cases: [{ id: 'c<1>', input: 'q', expected: 'a' }],
      },
      deltas: null,
    });
    expect(xml).not.toMatch(/classname="s" name="c<1>"/);
    expect(xml).toMatch(/name="c&lt;1&gt;"/);
    expect(xml).toMatch(/message="bad &amp; &quot;weird&quot; &lt; &gt;"/);
    expect(xml).toMatch(/name="Suite &quot;A&quot; &amp; &lt;B&gt;"/);
    expect(() => parser.parse(xml)).not.toThrow();
  });

  it('reports total time from the run span and per-case time from latencyMs', () => {
    const xml = renderJUnitXml({
      run: makeRun([makeCase('c1', { latencyMs: 1500 })]),
      suite: makeSuite(['c1']),
      deltas: null,
    });
    const parsed = parser.parse(xml);
    expect(parsed.testsuites.time).toBe('5.500');
    expect(parsed.testsuites.testsuite.testcase.time).toBe('1.500');
  });

  it('handles a zero-case run without crashing', () => {
    const xml = renderJUnitXml({
      run: makeRun([]),
      suite: { version: 1, id: 's', name: 'Empty', cases: [{ id: 'unused', input: 'q', expected: 'a' }] },
      deltas: null,
    });
    const parsed = parser.parse(xml);
    expect(Number(parsed.testsuites.tests)).toBe(0);
    expect(parsed.testsuites.testsuite.testcase).toBeUndefined();
  });

  it('falls back to suite.id when suite.name is empty-ish', () => {
    const xml = renderJUnitXml({
      run: makeRun([makeCase('c1')]),
      suite: {
        version: 1,
        id: 'fallback-id',
        name: '',
        cases: [{ id: 'c1', input: 'q', expected: 'a' }],
      } as Suite,
      deltas: null,
    });
    expect(xml).toMatch(/<testsuite name="fallback-id"/);
  });

  it('clamps negative or non-finite durations to 0.000', () => {
    const xml = renderJUnitXml({
      run: {
        ...makeRun([makeCase('c1', { latencyMs: -5 })]),
        startedAt: new Date('2026-04-23T00:00:01.000Z'),
        completedAt: new Date('2026-04-23T00:00:00.000Z'),
      },
      suite: makeSuite(['c1']),
      deltas: null,
    });
    expect(xml).toMatch(/time="0\.000"/);
  });
});
