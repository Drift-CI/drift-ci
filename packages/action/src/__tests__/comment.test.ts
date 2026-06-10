import { describe, it, expect, vi } from 'vitest';
import type { CaseResult, DeltaReport, RunResult, Suite } from '@drift-ci/core';

import {
  COMMENT_MARKER,
  findExistingCommentId,
  postOrUpdateComment,
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
    deltas: emptyDeltas(),
    threshold: 0.1,
    baselineSource: 'branch',
    baselineChanged: [],
    ...overrides,
  };
}

describe('renderComment', () => {
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
    expect(out).toMatch(/drift-ci baseline accept --cases c1/);
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
    expect(out).toMatch(/npx drift-ci baseline accept --cases c1,c2/);
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
