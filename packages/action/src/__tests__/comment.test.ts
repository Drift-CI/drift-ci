import { describe, it, expect, vi } from 'vitest';
import type { CaseResult, DeltaReport, RunResult, Suite } from '@drift-ci/core';

import type { BaselineChange } from '../baseline-changes.js';
import {
  COMMENT_MARKER,
  findExistingCommentId,
  postOrUpdateComment,
  renderBaselineChanges,
  renderComment,
  type CommentApi,
  type RenderCommentInput,
} from '../comment.js';

function makeCase(id: string, overrides: Partial<CaseResult> = {}): CaseResult {
  return {
    caseId: id,
    runId: 'run-1',
    output: 'out',
    score: 1,
    threshold: 0.1,
    latencyMs: 200,
    status: 'pass',
    ...overrides,
  };
}

function makeRun(cases: CaseResult[], overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: '1f2c3d4e-aaaa-bbbb-cccc-1234567890ab',
    suiteId: 's',
    provider: 'mock/m',
    startedAt: new Date('2026-04-23T00:00:00.000Z'),
    completedAt: new Date('2026-04-23T00:00:01.500Z'),
    cases,
    summary: {
      total: cases.length,
      passed: cases.filter((c) => c.status === 'pass').length,
      transient: cases.filter((c) =>
        ['provider-rate-limit', 'provider-network', 'timeout'].includes(c.status),
      ).length,
      evaluatorErrors: cases.filter((c) => c.status === 'evaluator-error').length,
      failed: 0,
      regressions: 0,
      avgScore: 1,
      avgLatencyMs: 200,
    },
    ...overrides,
  };
}

function makeSuite(caseIds: string[]): Suite {
  return {
    version: 1,
    id: 's',
    name: 'Greetings',
    cases: caseIds.map((id) => ({ id, input: `q-${id}`, expected: `a-${id}` })),
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

function baseInput(overrides: Partial<RenderCommentInput> = {}): RenderCommentInput {
  return {
    run: makeRun([makeCase('c1'), makeCase('c2')]),
    suite: makeSuite(['c1', 'c2']),
    suitePath: '.drift/suite.yaml',
    deltas: emptyDeltas(),
    threshold: 0.1,
    baselineSource: 'branch',
    baselineChanged: [],
    ...overrides,
  };
}

describe('renderComment', () => {
  it('marks sampled cases with the sample count', () => {
    const samples = [
      { score: 1, status: 'pass' },
      { score: 0, status: 'pass' },
      { score: 1, status: 'pass' },
    ];
    const out = renderComment(
      baseInput({
        run: makeRun([makeCase('c1', { evaluatorBreakdown: { samples } }), makeCase('c2')]),
      }),
    );
    const c1Row = out.split('\n').find((l) => l.includes('`c1`'))!;
    const c2Row = out.split('\n').find((l) => l.includes('`c2`'))!;
    expect(c1Row).toContain('<sub>median of 3</sub>');
    expect(c2Row).not.toContain('median of');
  });

  it('says "N samples", not "median", for a sampled case with no score', () => {
    const samples = [{ score: null, status: 'timeout' }, { score: null, status: 'timeout' }, { score: 1, status: 'pass' }];
    const out = renderComment(
      baseInput({
        run: makeRun([makeCase('c1', { score: NaN, status: 'timeout', evaluatorBreakdown: { samples } }), makeCase('c2')]),
        deltas: { ...emptyDeltas(), noScore: ['c1'] },
      }),
    );
    const c1Row = out.split('\n').find((l) => l.includes('`c1`'))!;
    expect(c1Row).toContain('— <sub>3 samples</sub>');
    expect(c1Row).not.toContain('median of');
  });

  it('renders the stale-judge accept command with the CLI package and suite path', () => {
    const out = renderComment(
      baseInput({
        suitePath: 'evals/my suite.yaml',
        deltas: { ...emptyDeltas(), staleJudges: ['c1'] },
      }),
    );
    expect(out).toContain("npx @drift-ci/cli baseline accept 'evals/my suite.yaml' --cases c1");
  });

  it('starts with the hidden marker so subsequent runs can find it', () => {
    const out = renderComment(baseInput());
    expect(out.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it('renders the green header when there are no regressions', () => {
    const out = renderComment(baseInput());
    expect(out).toMatch(/## 🟢 drift-ci/);
    expect(out).toMatch(/All cases passed/);
  });

  it('renders the red header and a regression count when regressions exist', () => {
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      regressions: ['c1'],
      deltas: { c1: -0.42 },
    };
    const out = renderComment(
      baseInput({
        run: makeRun([makeCase('c1', { score: 0.58 }), makeCase('c2')]),
        deltas,
      }),
    );
    expect(out).toMatch(/## 🔴 drift-ci/);
    expect(out).toMatch(/\*\*1 regression\(s\) detected\*\*/);
    // Regression row carries bolded delta + warning glyph.
    expect(out).toMatch(/\| 🔴 \| `c1` \| 0\.580 \| \*\*-0\.420\*\* ⚠️/);
  });

  it('renders the per-case table with score, delta, and latency for every case', () => {
    const out = renderComment(baseInput());
    expect(out).toMatch(/\| 🟢 \| `c1` \| 1\.000 \| \+0\.000 \| 200 ms \|/);
    expect(out).toMatch(/\| 🟢 \| `c2` \| 1\.000 \| \+0\.000 \| 200 ms \|/);
  });

  it('marks rows whose case has no baseline as `_no baseline_`', () => {
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      missingBaselines: ['c1'],
    };
    const out = renderComment(baseInput({ deltas }));
    expect(out).toMatch(/\| `c1` \| 1\.000 \| _no baseline_ \|/);
  });

  it('renders the canonical stale-baseline block per stale case', () => {
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      staleBaselines: ['c1'],
    };
    const out = renderComment(
      baseInput({
        deltas,
        baselineHashes: {
          c1: {
            baselineSuiteHash: 'sha256:abcdef0123456789',
            currentSuiteHash: 'sha256:9876fedcba000000',
          },
        },
      }),
    );
    expect(out).toMatch(/⚠️ \*\*Stale baseline\.\*\*/);
    expect(out).toMatch(
      /captured against a different suite definition.*baseline suiteHash: `abcdef01`.*current suiteHash: `9876fedc`/s,
    );
    expect(out).toContain('npx @drift-ci/cli baseline accept .drift/suite.yaml --cases c1');
    expect(out).not.toMatch(/npx drift-ci/);
  });

  it('renders an informational stale-judge block (ℹ️) without flagging regression', () => {
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      staleJudges: ['c1'],
    };
    const out = renderComment(baseInput({ deltas }));
    expect(out).toMatch(/ℹ️ \*\*Stale judge\.\*\*/);
    // Status must remain green — judge drift is not a regression.
    expect(out).toMatch(/## 🟢 drift-ci/);
    expect(out).toMatch(/All cases passed/);
    expect(out).not.toMatch(/regression\(s\) detected/);
  });

  it('renders a transient-failure badge grouped by status, distinct from regressions', () => {
    const cases = [
      makeCase('c1', { status: 'provider-rate-limit', score: Number.NaN }),
      makeCase('c2', { status: 'provider-network', score: Number.NaN }),
      makeCase('c3'),
    ];
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      noScore: ['c1', 'c2'],
    };
    const out = renderComment(
      baseInput({
        run: makeRun(cases),
        suite: makeSuite(['c1', 'c2', 'c3']),
        deltas,
      }),
    );
    expect(out).toMatch(/❗ \*\*Transient provider failures\*\* for 2 case\(s\)/);
    expect(out).toMatch(/`provider-rate-limit`: `c1`/);
    expect(out).toMatch(/`provider-network`: `c2`/);
    // Status icon for transient rows is 🟡, not 🔴.
    expect(out).toMatch(/\| 🟡 \| `c1` \| — \| — \| /);
  });

  it('renders an evaluator-error badge with 🟠', () => {
    const cases = [
      makeCase('c1', { status: 'evaluator-error', score: Number.NaN }),
      makeCase('c2'),
    ];
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      noScore: ['c1'],
    };
    const out = renderComment(
      baseInput({
        run: makeRun(cases),
        deltas,
      }),
    );
    expect(out).toMatch(/🟠 \*\*Evaluator errors\*\* for 1 case/);
    expect(out).toMatch(/\| 🟠 \| `c1` \|/);
  });

  it('appends an "accept regressions" footer with copy-paste commands when regressions exist', () => {
    const deltas: DeltaReport = {
      ...emptyDeltas(),
      regressions: ['c1', 'c2'],
      deltas: { c1: -0.5, c2: -0.3 },
    };
    const out = renderComment(
      baseInput({
        run: makeRun([
          makeCase('c1', { score: 0.5 }),
          makeCase('c2', { score: 0.7 }),
        ]),
        deltas,
      }),
    );
    expect(out).toMatch(/✅ If these regressions are intentional/);
    expect(out).toContain('npx @drift-ci/cli baseline accept .drift/suite.yaml --cases c1,c2');
    expect(out).not.toMatch(/npx drift-ci/);
    expect(out).toMatch(/git add \.drift\/baseline\//);
  });

  it('omits the accept footer when no regressions exist', () => {
    const out = renderComment(baseInput());
    expect(out).not.toMatch(/If these regressions are intentional/);
  });

  it('renders the baseline-source=main note only when baseline-changed is non-empty', () => {
    const out = renderComment(
      baseInput({ baselineSource: 'main', baselineChanged: ['.drift/baseline/c1.json'] }),
    );
    expect(out).toMatch(/baseline-source: main/);
    const out2 = renderComment(baseInput({ baselineSource: 'main', baselineChanged: [] }));
    expect(out2).not.toMatch(/baseline-source: main/);
  });

  it('includes a dashboard link when dashboardUrl is provided', () => {
    const out = renderComment(baseInput({ dashboardUrl: 'https://dash.example' }));
    expect(out).toMatch(/\[📊 dashboard\]\(https:\/\/dash\.example\/runs\/[\w-]+\)/);
  });

  it('shows threshold percentage in the explainer footer', () => {
    const out = renderComment(baseInput({ threshold: 0.15 }));
    expect(out).toMatch(/more than \*\*15%\*\* below the committed baseline/);
  });

  it('escapes pipe characters in case ids and suite names', () => {
    const out = renderComment(
      baseInput({
        suite: {
          version: 1,
          id: 's',
          name: 'a|b',
          cases: [{ id: 'c|d', input: 'q', expected: 'a' }],
        },
        run: makeRun([makeCase('c|d')]),
      }),
    );
    expect(out).toMatch(/`a\\\|b`/);
    expect(out).toMatch(/`c\\\|d`/);
  });

  it('escapes backslashes before pipes so the escape cannot be neutralised', () => {
    const out = renderComment(
      baseInput({
        suite: {
          version: 1,
          id: 's',
          name: 'a\\|b',
          cases: [{ id: 'c1', input: 'q', expected: 'a' }],
        },
        run: makeRun([makeCase('c1')]),
      }),
    );
    // Backslash is doubled first, then the pipe escaped: `a\|b` -> `a\\\|b`.
    // The previous code escaped only the pipe, yielding `a\\|b` — a literal
    // backslash followed by an *unescaped* pipe that breaks out of the cell.
    expect(out).toContain('a\\\\\\|b');
  });

  it('formats latencies above 1000 ms in seconds', () => {
    const out = renderComment(
      baseInput({ run: makeRun([makeCase('c1', { latencyMs: 1234 })]) }),
    );
    expect(out).toMatch(/1\.2 s/);
  });
});

describe('findExistingCommentId', () => {
  it('returns the id of the first comment containing the marker', () => {
    const id = findExistingCommentId([
      { id: 1, body: 'unrelated' },
      { id: 2, body: `${COMMENT_MARKER}\n\nsome body` },
      { id: 3, body: 'also unrelated' },
    ]);
    expect(id).toBe(2);
  });

  it('returns null when no comment carries the marker', () => {
    expect(
      findExistingCommentId([
        { id: 1, body: 'a' },
        { id: 2, body: null },
      ]),
    ).toBeNull();
  });

  it('handles undefined / null bodies gracefully', () => {
    expect(findExistingCommentId([{ id: 1, body: undefined }])).toBeNull();
    expect(findExistingCommentId([{ id: 1, body: null }])).toBeNull();
  });
});

describe('postOrUpdateComment', () => {
  function makeApi(initial: Array<{ id: number; body: string | null }>): {
    api: CommentApi;
    state: { comments: Array<{ id: number; body: string | null }>; nextId: number };
  } {
    const state = { comments: [...initial], nextId: 100 };
    const api: CommentApi = {
      list: vi.fn(async () =>
        state.comments.map((c) => ({ id: c.id, body: c.body })),
      ),
      update: vi.fn(async ({ commentId, body }) => {
        const c = state.comments.find((x) => x.id === commentId);
        if (c) c.body = body;
      }),
      create: vi.fn(async ({ body }) => {
        const id = state.nextId++;
        state.comments.push({ id, body });
        return { id };
      }),
    };
    return { api, state };
  }

  const ctx = { owner: 'octocat', repo: 'hello', prNumber: 42 };

  it('creates a new comment when no existing marker is found', async () => {
    const { api, state } = makeApi([{ id: 1, body: 'unrelated chatter' }]);
    const out = await postOrUpdateComment(api, ctx, `${COMMENT_MARKER}\nhello`);
    expect(out.action).toBe('created');
    expect(state.comments.length).toBe(2);
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.update).not.toHaveBeenCalled();
  });

  it('updates the existing marker comment', async () => {
    const { api, state } = makeApi([
      { id: 1, body: 'unrelated' },
      { id: 7, body: `${COMMENT_MARKER}\n\nold body` },
    ]);
    const out = await postOrUpdateComment(api, ctx, `${COMMENT_MARKER}\n\nnew body`);
    expect(out.action).toBe('updated');
    expect(out.id).toBe(7);
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();
    expect(state.comments.find((c) => c.id === 7)?.body).toContain('new body');
  });

  it('is idempotent across repeated runs (always touches the same comment)', async () => {
    const { api } = makeApi([]);
    const a = await postOrUpdateComment(api, ctx, `${COMMENT_MARKER}\nfirst`);
    const b = await postOrUpdateComment(api, ctx, `${COMMENT_MARKER}\nsecond`);
    const c = await postOrUpdateComment(api, ctx, `${COMMENT_MARKER}\nthird`);
    expect(a.action).toBe('created');
    expect(b.action).toBe('updated');
    expect(c.action).toBe('updated');
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
  });
});

describe('renderBaselineChanges', () => {
  const ch = (o: Partial<BaselineChange> & { caseId: string }): BaselineChange => ({
    path: `.drift/baseline/${o.caseId}.json`,
    kind: 'lowered',
    ...o,
  });
  const mixed: BaselineChange[] = [
    ch({ caseId: 'refund-policy', kind: 'lowered', oldScore: 0.91, newScore: 0.64, oldOutput: 'a\nb', newOutput: 'a\nc' }),
    ch({ caseId: 'greeting', kind: 'raised', oldScore: 0.7, newScore: 0.88, oldOutput: 'x', newOutput: 'x' }),
    ch({ caseId: 'tone', kind: 'output-changed', oldScore: 1, newScore: 1, oldOutput: 'p', newOutput: 'q' }),
    ch({ caseId: 'new-case', kind: 'added', newScore: 0.95, newOutput: 'n' }),
    ch({ caseId: 'old-case', kind: 'removed', oldScore: 0.8, oldOutput: 'o' }),
    ch({ caseId: 'meta', kind: 'unchanged', oldScore: 1, newScore: 1 }),
    ch({ caseId: 'meta2', kind: 'unchanged', oldScore: 1, newScore: 1 }),
  ];

  it('renders heading, summary, warning, table and unchanged count', () => {
    const md = renderBaselineChanges(mixed);
    expect(md).toContain('### 📝 Baselines changed in this PR (5)');
    expect(md).toContain('1 lowered · 1 raised · 1 output changed · 1 added · 1 removed');
    expect(md).toContain('Lowering a baseline accepts worse behaviour');
    expect(md).toContain('| `refund-policy` | 0.910 → 0.640 | **-0.270** ⬇️ |');
    expect(md).toContain('| `greeting` | 0.700 → 0.880 | +0.180 |');
    expect(md).toContain('| `tone` | 1.000 → 1.000 | output changed |');
    expect(md).toContain('| `new-case` | → 0.950 | added |');
    expect(md).toContain('| `old-case` | 0.800 → | removed |');
    expect(md).toContain('Plus 2 re-captured with no score or output change.');
    expect(md).toContain('<summary>Output diff: <code>refund-policy</code></summary>');
    expect(md).toContain('```diff\n  a\n- b\n+ c\n```');
  });

  it('omits the warning when nothing was lowered', () => {
    const md = renderBaselineChanges([mixed[1]!]);
    expect(md).not.toContain('Lowering a baseline');
  });

  it('returns empty string for an empty list and renderComment omits the section', () => {
    expect(renderBaselineChanges([])).toBe('');
    expect(renderComment(baseInput({ baselineChanges: [] }))).not.toContain('Baselines changed');
    expect(renderComment(baseInput())).not.toContain('Baselines changed');
    expect(renderComment(baseInput({ baselineChanges: mixed }))).toContain('Baselines changed in this PR');
  });

  it('caps a diff at 60 lines', () => {
    const big = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
    const md = renderBaselineChanges([ch({ caseId: 'c', oldScore: 1, newScore: 0, oldOutput: big, newOutput: '' })]);
    expect(md).toContain('… 40 more lines');
    expect(md).not.toContain('line99');
  });

  it('shows at most 10 diffs', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ch({ caseId: `c${i}`, oldScore: 1, newScore: 0.5, oldOutput: 'a', newOutput: 'b' }),
    );
    const md = renderBaselineChanges(many);
    expect(md.match(/<details>/g)).toHaveLength(10);
    expect(md).toContain('2 more output diff(s) omitted');
  });

  it('stops adding diffs once the size budget is hit', () => {
    const out = 'x'.repeat(200) + '\n';
    const many = Array.from({ length: 10 }, (_, i) =>
      ch({
        caseId: `c${i}`,
        oldScore: 1,
        newScore: 0.5,
        oldOutput: Array.from({ length: 60 }, (_, j) => `${out}${i}-${j}`).join('\n'),
        newOutput: '',
      }),
    );
    const md = renderBaselineChanges(many);
    expect(md.match(/<details>/g)!.length).toBeLessThan(10);
    expect(md).toContain('more output diff(s) omitted');
    expect(md.length).toBeLessThan(31_000);
  });

  it('uses a fence longer than any backtick run in the output', () => {
    const md = renderBaselineChanges([
      ch({ caseId: 'c', oldScore: 1, newScore: 0, oldOutput: 'a ````` b', newOutput: 'ok' }),
    ]);
    expect(md).toContain('``````diff');
    expect(md).toMatch(/\n``````\n<\/details>/);
  });

  it('escapes case IDs in the table and summary', () => {
    const md = renderBaselineChanges([
      ch({ caseId: 'a|b`<x>&', oldScore: 1, newScore: 0, oldOutput: 'a', newOutput: 'b' }),
    ]);
    expect(md).toContain('| `a\\|bˋ<x>&` | 1.000');
    expect(md).toContain('<code>a|b`&lt;x&gt;&amp;</code>');
  });
});

describe('renderBaselineChanges hardening', () => {
  const ch = (o: Partial<BaselineChange> & { caseId: string }): BaselineChange => ({
    path: `.drift/baseline/${o.caseId}.json`,
    kind: 'lowered',
    oldScore: 1,
    newScore: 0.5,
    oldOutput: 'a',
    newOutput: 'b',
    ...o,
  });

  it('neutralises newlines and markdown in case IDs (table and summary)', () => {
    const md = renderBaselineChanges([ch({ caseId: 'x\n\n@octocat [a](https://e)\r\n<!--' })]);
    for (const line of md.split('\n')) {
      expect(line.startsWith('@octocat')).toBe(false);
      expect(line.startsWith('<!--')).toBe(false);
    }
    const row = md.split('\n').find((l) => l.startsWith('| `x'))!;
    expect(row).toContain('`x  @octocat [a](https://e)  <!--`');
    const summary = md.split('\n').find((l) => l.startsWith('<details>'))!;
    expect(summary).not.toContain('[a](');
    expect(summary).not.toContain('<!--');
    expect(summary).not.toContain('@octocat');
  });

  it('caps long IDs and names empty IDs', () => {
    const md = renderBaselineChanges([ch({ caseId: 'z'.repeat(500) }), ch({ caseId: '\n\n' })]);
    expect(md).toContain('`' + 'z'.repeat(120) + '…`');
    expect(md).toContain('`unnamed`');
  });

  it('strips control characters in the results table too', () => {
    const run = makeRun([makeCase('evil\n@octocat')]);
    const md = renderComment(baseInput({ run, suite: makeSuite(['evil']) }));
    expect(md.split('\n').some((l) => l.startsWith('@octocat'))).toBe(false);
  });

  it('survives an output with hundreds of thousands of backtick runs', () => {
    const out = '` '.repeat(300_000);
    const t = Date.now();
    const md = renderBaselineChanges([ch({ oldOutput: out, newOutput: 'x' })]);
    expect(md).toContain('```');
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('survives huge line-count outputs', () => {
    const a = Array.from({ length: 200_000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 200_000 }, (_, i) => `b${i}`).join('\n');
    const t = Date.now();
    const md = renderBaselineChanges([ch({ oldOutput: a, newOutput: b })]);
    expect(md).toContain('more lines');
    expect(Date.now() - t).toBeLessThan(3000);
  });

  it('caps the table at 50 rows, keeping lowered first', () => {
    const many = Array.from({ length: 80 }, (_, i) => ch({ caseId: `c${i}` }));
    const md = renderBaselineChanges(many);
    expect(md.match(/^\| `c\d+`/gm)).toHaveLength(50);
    expect(md).toContain('… 30 more — see *Files changed*');
  });

  it('keeps the whole comment under 65,000 chars with thousands of changes', () => {
    const many = Array.from({ length: 3000 }, (_, i) =>
      ch({ caseId: `case-${i}`, oldOutput: 'o'.repeat(500), newOutput: 'n'.repeat(500) }),
    );
    const body = renderComment(baseInput({ baselineChanges: many }));
    expect(body.length).toBeLessThanOrEqual(65_000);
    expect(body).toContain('Baselines changed in this PR');
  });

  it('falls back to a compact section when the body is too large', () => {
    const run = makeRun(
      Array.from({ length: 700 }, (_, i) => makeCase(`long-case-id-number-${i}-` + 'x'.repeat(40))),
    );
    const many = Array.from({ length: 100 }, (_, i) => ch({ caseId: `c${i}` }));
    const body = renderComment(
      baseInput({ run, suite: makeSuite([]), baselineChanges: many }),
    );
    expect(body).toContain('Details omitted to keep this comment within GitHub');
    expect(body).toContain('100 lowered');
  });

  it('renders only a re-captured line when every file is unchanged', () => {
    const md = renderBaselineChanges([
      ch({ caseId: 'a', kind: 'unchanged' }),
      ch({ caseId: 'b', kind: 'unchanged' }),
    ]);
    expect(md).toBe('<sub>📝 2 baseline file(s) re-captured with no score or output change.</sub>');
  });

  it('mentions skipped files', () => {
    const md = renderBaselineChanges([ch({ caseId: 'a' })], { skipped: 2 });
    expect(md).toContain('2 baseline file(s) could not be read and are not shown.');
    expect(renderBaselineChanges([], { skipped: 1 })).toContain('1 baseline file(s) could not be read');
  });

  it('renderComment omits the section instead of throwing when rendering fails', () => {
    const bad = { get caseId(): string { throw new Error('boom'); } } as unknown as BaselineChange;
    expect(() => renderComment(baseInput({ baselineChanges: [bad] }))).not.toThrow();
  });
});
