import { describe, it, expect, vi } from 'vitest';

import {
  RubricChecklistEvaluator,
  normaliseRubric,
  parseJudgeResponse,
  type NamedJudge,
  type RubricChecklistMetadata,
} from '../rubric-checklist.js';
import { createEvaluatorChain } from '../factory.js';
import type { ProviderAdapter } from '../../providers/base.js';
import type { CompletionResponse } from '../../providers/base.js';
import type { RubricSpec } from '../../types/suite.js';

// ─── helpers ────────────────────────────────────────────────────────────

class StubJudge implements ProviderAdapter {
  readonly name: string;
  send = vi.fn<[unknown, unknown, unknown], Promise<CompletionResponse>>();

  constructor(name: string, public scriptedResponse: () => string) {
    this.name = name;
  }

  async complete(): Promise<CompletionResponse> {
    return {
      text: this.scriptedResponse(),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: this.name,
      latencyMs: 1,
    };
  }
}

function namedJudge(name: string, response: () => string, key = 'default'): NamedJudge {
  return { key, provider: new StubJudge(name, response) };
}

function judgeResponse(items: Array<{ id: string; passed: boolean; score: number; reason?: string }>): string {
  return JSON.stringify({ items });
}

const baseInput = { input: 'q', output: 'a', expected: undefined as string | undefined };

// ─── normalisation ──────────────────────────────────────────────────────

describe('normaliseRubric', () => {
  it('rejects 1-item rubric (loader-level invariant — runtime safety net)', () => {
    expect(() => normaliseRubric(['only one'] as RubricSpec)).toThrow(/at least 2/);
  });

  it('rejects 21-item rubric (loader-level invariant — runtime safety net)', () => {
    const r = Array.from({ length: 21 }, (_, i) => `item ${i}`) as RubricSpec;
    expect(() => normaliseRubric(r)).toThrow(/at most 20/);
  });

  it('rejects a sum > 1.0 (test 7: weight-sum mismatch)', () => {
    expect(() =>
      normaliseRubric([
        { text: 'a', weight: 0.5, mode: 'lenient' },
        { text: 'b', weight: 0.5, mode: 'lenient' },
        { text: 'c', weight: 0.1, mode: 'lenient' },
      ] as RubricSpec),
    ).toThrow(/sum to 1\.0/);
  });

  it('auto-generates `item-1`, `item-2`, ... ids for shorthand entries (test 10)', () => {
    const r = normaliseRubric(['first', 'second', 'third'] as RubricSpec);
    expect(r.map((i) => i.id)).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('preserves explicit ids while filling auto ids around them (test 11)', () => {
    const r = normaliseRubric([
      'first',
      { id: 'foo', text: 'second', mode: 'lenient' },
      'third',
    ] as RubricSpec);
    expect(r.map((i) => i.id)).toEqual(['item-1', 'foo', 'item-3']);
  });

  it('throws on duplicate ids (auto + explicit collision)', () => {
    // The shorthand 'first' becomes item-1; an explicit `id: item-1` collides.
    expect(() =>
      normaliseRubric([
        'first',
        { id: 'item-1', text: 'second', mode: 'lenient' },
      ] as RubricSpec),
    ).toThrow(/duplicate item id/);
  });

  it('splits the implicit weight remainder evenly (test 6)', () => {
    const r = normaliseRubric([
      { text: 'a', weight: 0.6, mode: 'lenient' },
      'b',
      'c',
    ] as RubricSpec);
    expect(r[0].weight).toBeCloseTo(0.6, 5);
    expect(r[1].weight).toBeCloseTo(0.2, 5);
    expect(r[2].weight).toBeCloseTo(0.2, 5);
  });

  it('uses equal weights when none are explicit (test 2 / shorthand path)', () => {
    const r = normaliseRubric(['a', 'b', 'c', 'd'] as RubricSpec);
    for (const item of r) {
      expect(item.weight).toBeCloseTo(0.25, 5);
    }
  });

  it('honours all explicit weights when provided (test 5)', () => {
    const r = normaliseRubric([
      { text: 'a', weight: 0.5, mode: 'lenient' },
      { text: 'b', weight: 0.3, mode: 'lenient' },
      { text: 'c', weight: 0.2, mode: 'lenient' },
    ] as RubricSpec);
    expect(r.map((i) => i.weight)).toEqual([0.5, 0.3, 0.2]);
  });
});

// ─── single-judge evaluation ───────────────────────────────────────────

describe('RubricChecklistEvaluator (single judge)', () => {
  it('test 1: all-strict, all-pass → score 1.0', async () => {
    const judge = namedJudge('judge-a', () =>
      judgeResponse([
        { id: 'item-1', passed: true, score: 1 },
        { id: 'item-2', passed: true, score: 1 },
        { id: 'item-3', passed: true, score: 1 },
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
        { text: 'c', mode: 'strict' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBe(1);
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.rubric).toHaveLength(3);
    expect(meta.rubric.every((r) => r.passed && r.score === 1)).toBe(true);
  });

  it('test 2: all-strict, half-pass with default weights → score 0.5', async () => {
    const judge = namedJudge('judge-a', () =>
      judgeResponse([
        { id: 'item-1', passed: true, score: 1 },
        { id: 'item-2', passed: true, score: 1 },
        { id: 'item-3', passed: false, score: 0 },
        { id: 'item-4', passed: false, score: 0 },
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
        { text: 'c', mode: 'strict' },
        { text: 'd', mode: 'strict' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBeCloseTo(0.5, 5);
  });

  it('test 3: all-lenient, weighted mean of judge scores', async () => {
    const judge = namedJudge('j', () =>
      judgeResponse([
        { id: 'item-1', passed: true, score: 0.8 },
        { id: 'item-2', passed: true, score: 0.5 },
        { id: 'item-3', passed: true, score: 1.0 },
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'lenient' },
        { text: 'b', mode: 'lenient' },
        { text: 'c', mode: 'lenient' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    // (0.8 + 0.5 + 1.0) / 3 = 0.7666...
    expect(out.score).toBeCloseTo((0.8 + 0.5 + 1.0) / 3, 5);
  });

  it('test 4: mixed strict + lenient items honour their respective scores', async () => {
    const judge = namedJudge('j', () =>
      judgeResponse([
        { id: 'item-1', passed: true, score: 1 }, // strict pass
        { id: 'item-2', passed: true, score: 0.5 }, // lenient 0.5
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'strict', weight: 0.4, mode: 'strict' },
        { text: 'lenient', weight: 0.6, mode: 'lenient' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBeCloseTo(0.4 * 1 + 0.6 * 0.5, 5);
  });

  it('test 12: judge unparseable → whole-case fallback score 0', async () => {
    const judge = namedJudge('j', () => 'I cannot evaluate this.');
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'lenient' },
        { text: 'b', mode: 'lenient' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBe(0);
    expect(out.reason).toBe('judge-unparseable');
    expect(out.metadata).toBeUndefined();
  });

  it('test 13: judge omits an item → that item defaults to false/0/judge-omitted', async () => {
    const judge = namedJudge('j', () =>
      judgeResponse([
        { id: 'item-1', passed: true, score: 1 },
        // item-2, item-3 omitted
        { id: 'item-4', passed: true, score: 1 },
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
        { text: 'c', mode: 'strict' },
        { text: 'd', mode: 'strict' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.rubric[1]).toMatchObject({ passed: false, score: 0 });
    expect(meta.rubric[2]).toMatchObject({ passed: false, score: 0 });
    expect(meta.rubric[0]).toMatchObject({ passed: true, score: 1 });
    expect(meta.rubric[3]).toMatchObject({ passed: true, score: 1 });
  });

  it('test 14: judge returns extras → extras dropped, rubric scoring unaffected', async () => {
    const judge = namedJudge('j', () =>
      judgeResponse([
        { id: 'item-1', passed: true, score: 1 },
        { id: 'item-2', passed: true, score: 1 },
        { id: 'item-99', passed: false, score: 0 }, // extra
        { id: 'item-100', passed: false, score: 0 }, // extra
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.rubric).toHaveLength(2);
    expect(out.score).toBe(1);
  });

  it('test 15: judge returns out-of-order items → re-keyed by id before scoring', async () => {
    const judge = namedJudge('j', () =>
      judgeResponse([
        { id: 'item-3', passed: false, score: 0 },
        { id: 'item-1', passed: true, score: 1 },
        { id: 'item-2', passed: true, score: 1 },
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
        { text: 'c', mode: 'strict' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    // metadata.rubric is in ORIGINAL rubric order, not response order
    expect(meta.rubric.map((r) => r.id)).toEqual(['item-1', 'item-2', 'item-3']);
    expect(meta.rubric[2].passed).toBe(false);
    expect(out.score).toBeCloseTo(2 / 3, 5);
  });

  it('test 16: quorum=1 → quorumApplied: false, no judgeVotes', async () => {
    const judge = namedJudge('j', () =>
      judgeResponse([
        { id: 'item-1', passed: true, score: 1 },
        { id: 'item-2', passed: true, score: 1 },
      ]),
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
      ],
      judges: [judge],
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.quorumApplied).toBe(false);
    expect(meta.rubric.every((r) => r.judgeVotes === undefined)).toBe(true);
    expect(meta.judgesUsed).toEqual(['default']);
    expect(meta.threshold).toBeUndefined();
  });
});

// ─── multi-judge quorum ────────────────────────────────────────────────

describe('RubricChecklistEvaluator (quorum)', () => {
  it('test 17: quorum=3 majority strict, 2-of-3 pass → item passes', async () => {
    const j1 = namedJudge('j1', () =>
      judgeResponse([{ id: 'item-1', passed: true, score: 1 }, { id: 'item-2', passed: true, score: 1 }]),
      'primary',
    );
    const j2 = namedJudge('j2', () =>
      judgeResponse([{ id: 'item-1', passed: true, score: 1 }, { id: 'item-2', passed: true, score: 1 }]),
      'secondary',
    );
    const j3 = namedJudge('j3', () =>
      judgeResponse([{ id: 'item-1', passed: false, score: 0 }, { id: 'item-2', passed: true, score: 1 }]),
      'tertiary',
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
      ],
      judges: [j1, j2, j3],
      threshold: 'majority',
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.quorumApplied).toBe(true);
    expect(meta.threshold).toBe('majority');
    expect(meta.rubric[0].passed).toBe(true);
    expect(meta.rubric[0].judgeVotes).toHaveLength(3);
    expect(out.score).toBe(1);
  });

  it('test 18: quorum=3 majority strict, 1-of-3 pass → item fails', async () => {
    const j1 = namedJudge('j1', () =>
      judgeResponse([{ id: 'item-1', passed: true, score: 1 }, { id: 'item-2', passed: true, score: 1 }]),
      'a',
    );
    const j2 = namedJudge('j2', () =>
      judgeResponse([{ id: 'item-1', passed: false, score: 0 }, { id: 'item-2', passed: true, score: 1 }]),
      'b',
    );
    const j3 = namedJudge('j3', () =>
      judgeResponse([{ id: 'item-1', passed: false, score: 0 }, { id: 'item-2', passed: true, score: 1 }]),
      'c',
    );
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
      ],
      judges: [j1, j2, j3],
      threshold: 'majority',
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.rubric[0].passed).toBe(false);
    expect(out.score).toBe(0.5);
  });

  it('test 19: quorum=3 unanimous strict, 2-of-3 pass → item fails despite majority', async () => {
    const judges = [
      namedJudge('a', () => judgeResponse([{ id: 'item-1', passed: true, score: 1 }, { id: 'item-2', passed: true, score: 1 }]), 'a'),
      namedJudge('b', () => judgeResponse([{ id: 'item-1', passed: true, score: 1 }, { id: 'item-2', passed: true, score: 1 }]), 'b'),
      namedJudge('c', () => judgeResponse([{ id: 'item-1', passed: false, score: 0 }, { id: 'item-2', passed: true, score: 1 }]), 'c'),
    ];
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'strict' },
        { text: 'b', mode: 'strict' },
      ],
      judges,
      threshold: 'unanimous',
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.rubric[0].passed).toBe(false);
    expect(out.score).toBe(0.5);
  });

  it('test 20: quorum=3 lenient majority → score is the mean', async () => {
    const judges = [
      namedJudge('a', () => judgeResponse([{ id: 'item-1', passed: true, score: 0.8 }, { id: 'item-2', passed: true, score: 1 }]), 'a'),
      namedJudge('b', () => judgeResponse([{ id: 'item-1', passed: false, score: 0.4 }, { id: 'item-2', passed: true, score: 1 }]), 'b'),
      namedJudge('c', () => judgeResponse([{ id: 'item-1', passed: true, score: 0.6 }, { id: 'item-2', passed: true, score: 1 }]), 'c'),
    ];
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'lenient' },
        { text: 'b', mode: 'lenient' },
      ],
      judges,
      threshold: 'majority',
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.rubric[0].score).toBeCloseTo((0.8 + 0.4 + 0.6) / 3, 5);
    expect(meta.rubric[0].passed).toBe(true); // mean 0.6 >= 0.5
  });

  it('test 21: quorum=3 lenient unanimous → score is min(scores)', async () => {
    const judges = [
      namedJudge('a', () => judgeResponse([{ id: 'item-1', passed: true, score: 0.8 }, { id: 'item-2', passed: true, score: 1 }]), 'a'),
      namedJudge('b', () => judgeResponse([{ id: 'item-1', passed: false, score: 0.4 }, { id: 'item-2', passed: true, score: 1 }]), 'b'),
      namedJudge('c', () => judgeResponse([{ id: 'item-1', passed: true, score: 0.6 }, { id: 'item-2', passed: true, score: 1 }]), 'c'),
    ];
    const ev = new RubricChecklistEvaluator({
      rubric: [
        { text: 'a', mode: 'lenient' },
        { text: 'b', mode: 'lenient' },
      ],
      judges,
      threshold: 'unanimous',
      testProviderName: 'test/x',
    });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as unknown as RubricChecklistMetadata;
    expect(meta.rubric[0].score).toBe(0.4);
    expect(meta.rubric[0].passed).toBe(false);
  });

  it('test 22: even-length majority quorum rejected at construction', () => {
    expect(
      () =>
        new RubricChecklistEvaluator({
          rubric: [
            { text: 'a', mode: 'strict' },
            { text: 'b', mode: 'strict' },
          ],
          judges: [
            namedJudge('a', () => '{}', 'a'),
            namedJudge('b', () => '{}', 'b'),
            namedJudge('c', () => '{}', 'c'),
            namedJudge('d', () => '{}', 'd'),
          ],
          threshold: 'majority',
          testProviderName: 'test/x',
        }),
    ).toThrow(/odd number of judges/);
  });

  it('test 24: rejects self-bias when test provider name overlaps with a judge', () => {
    expect(
      () =>
        new RubricChecklistEvaluator({
          rubric: [
            { text: 'a', mode: 'strict' },
            { text: 'b', mode: 'strict' },
          ],
          judges: [
            namedJudge('shared/x', () => '{}', 'primary'),
            namedJudge('judge-b', () => '{}', 'secondary'),
            namedJudge('judge-c', () => '{}', 'tertiary'),
          ],
          threshold: 'majority',
          testProviderName: 'shared/x', // same as primary's provider name
        }),
    ).toThrow(/overlaps with the provider under test/);
  });

  it('honours allowSelfBias to bypass the gate (air-gapped deployments)', () => {
    expect(
      () =>
        new RubricChecklistEvaluator({
          rubric: [
            { text: 'a', mode: 'strict' },
            { text: 'b', mode: 'strict' },
          ],
          judges: [namedJudge('shared/x', () => '{}')],
          testProviderName: 'shared/x',
          allowSelfBias: true,
        }),
    ).not.toThrow();
  });
});

// ─── factory wiring (test 23) ──────────────────────────────────────────

describe('createEvaluatorChain — rubric-checklist (test 23)', () => {
  function testProvider(): ProviderAdapter {
    return new StubJudge('test/x', () => '{}');
  }

  it('throws on unknown rubricQuorum.judges keys at factory-build time', () => {
    expect(() =>
      createEvaluatorChain(['rubric-checklist'], {
        testProvider: testProvider(),
        case: {
          rubric: [
            { text: 'a', mode: 'strict' },
            { text: 'b', mode: 'strict' },
          ],
          rubricQuorum: {
            judges: ['primary', 'unknown-key'],
            threshold: 'majority',
            allowSelfBias: false,
          },
        },
        judgesByKey: new Map([
          ['primary', new StubJudge('judge/a', () => '{}')],
        ]),
      }),
    ).toThrow(/unknown key/);
  });

  it('throws when rubricQuorum is set but no top-level judges map is provided', () => {
    expect(() =>
      createEvaluatorChain(['rubric-checklist'], {
        testProvider: testProvider(),
        case: {
          rubric: [
            { text: 'a', mode: 'strict' },
            { text: 'b', mode: 'strict' },
          ],
          rubricQuorum: {
            judges: ['primary'],
            threshold: 'majority',
            allowSelfBias: false,
          },
        },
        // no judgesByKey
      }),
    ).toThrow(/no top-level `judges:` map/);
  });

  it('throws when rubric-checklist is requested but `case.rubric` is absent', () => {
    expect(() =>
      createEvaluatorChain(['rubric-checklist'], {
        testProvider: testProvider(),
        case: {},
      }),
    ).toThrow(/requires a .rubric. field/);
  });

  it('builds successfully with a default judge (no quorum)', () => {
    expect(() =>
      createEvaluatorChain(['rubric-checklist'], {
        testProvider: testProvider(),
        judgeProvider: new StubJudge('judge/x', () => '{}'),
        case: {
          rubric: [
            { text: 'a', mode: 'strict' },
            { text: 'b', mode: 'strict' },
          ],
        },
      }),
    ).not.toThrow();
  });
});

// ─── parseJudgeResponse contracts ──────────────────────────────────────

describe('parseJudgeResponse', () => {
  it('returns null on non-JSON input', () => {
    expect(parseJudgeResponse('not json at all')).toBeNull();
  });

  it('returns null when items is missing', () => {
    expect(parseJudgeResponse('{"score": 1}')).toBeNull();
  });

  it('returns null when items entries are wrong shape', () => {
    expect(
      parseJudgeResponse(JSON.stringify({ items: [{ id: 1, passed: true, score: 1 }] })),
    ).toBeNull();
  });

  it('clamps out-of-range scores to [0, 1]', () => {
    const out = parseJudgeResponse(
      JSON.stringify({
        items: [
          { id: 'a', passed: true, score: 1.5 },
          { id: 'b', passed: false, score: -0.2 },
        ],
      }),
    );
    expect(out).not.toBeNull();
    expect(out![0].score).toBe(1);
    expect(out![1].score).toBe(0);
  });

  it('truncates over-long reason strings to 200 chars', () => {
    const long = 'X'.repeat(500);
    const out = parseJudgeResponse(
      JSON.stringify({ items: [{ id: 'a', passed: true, score: 1, reason: long }] }),
    );
    expect(out![0].reason?.length).toBe(200);
  });
});
