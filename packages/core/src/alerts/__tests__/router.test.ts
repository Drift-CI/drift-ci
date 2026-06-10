import { describe, it, expect, vi } from 'vitest';

import { AlertRouter } from '../router.js';
import type { AlertSender } from '../base.js';
import type { DeltaReport } from '../../engine/baseline.js';
import type { RunResult } from '../../types/result.js';
import type {
  AlertChannel,
  AlertPayload,
  AlertRule,
} from '../../types/alerts.js';

// ─── helpers ────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-25T12:00:00Z');

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'run-1',
    suiteId: 'suite-a',
    provider: 'anthropic/claude-sonnet-4-5',
    startedAt: new Date('2026-04-25T11:55:00Z'),
    completedAt: new Date('2026-04-25T11:59:00Z'),
    cases: [
      { caseId: 'a', runId: 'run-1', output: 'x', score: 0.5, threshold: 0.1, latencyMs: 100, status: 'pass' },
      { caseId: 'b', runId: 'run-1', output: 'y', score: 0.6, threshold: 0.1, latencyMs: 100, status: 'pass' },
      { caseId: 'c', runId: 'run-1', output: 'z', score: 0.9, threshold: 0.1, latencyMs: 100, status: 'pass' },
    ],
    summary: {
      total: 3,
      passed: 3,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 0.667,
      avgLatencyMs: 100,
    },
    ...overrides,
  };
}

function makeDeltas(overrides: Partial<DeltaReport> = {}): DeltaReport {
  return {
    deltas: { a: -0.3, b: -0.2, c: 0.0 },
    regressions: ['a', 'b'],
    improvements: [],
    missingBaselines: [],
    staleBaselines: [],
    staleJudges: [],
    noScore: [],
    ...overrides,
  };
}

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1',
    name: 'Production regressions',
    suiteId: undefined,
    trigger: { type: 'regression-threshold', threshold: 0.15 },
    channels: [
      { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
    ],
    enabled: true,
    cooldownMinutes: 0,
    ...overrides,
  };
}

class CapturingSender implements AlertSender {
  calls: Array<{ channel: AlertChannel; payload: AlertPayload }> = [];
  send = vi.fn(async (channel: AlertChannel, payload: AlertPayload) => {
    this.calls.push({ channel, payload });
  });
}

class FailingSender implements AlertSender {
  send = vi.fn(async () => {
    throw new Error('boom');
  });
}

function senderRegistry(...overrides: Array<[string, AlertSender]>): Map<string, AlertSender> {
  return new Map(overrides);
}

// ─── matching + dispatch ────────────────────────────────────────────────

describe('AlertRouter — matching', () => {
  it('fires when a regression-threshold trigger is hit', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
    });

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].outcome).toBe('fire');
    expect(slack.calls).toHaveLength(1);
    expect(slack.calls[0].payload.regressions).toHaveLength(2);
    expect(slack.calls[0].payload.reason).toMatch(/2 case\(s\) regressed/);
  });

  it('does not fire when no case crosses the threshold', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas({ deltas: { a: -0.05, b: 0.0, c: 0.1 }, regressions: [] }),
      rules: [rule()],
      now: FIXED_NOW,
    });

    expect(result.fired).toHaveLength(0);
    expect(result.decisions[0].outcome).toBe('no-match');
    expect(slack.send).not.toHaveBeenCalled();
  });

  it('honours a per-trigger caseId filter', async () => {
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));

    const onlyB = rule({
      id: 'r-b',
      trigger: { type: 'regression-threshold', threshold: 0.1, caseId: 'b' },
    });

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas({ deltas: { a: -0.5, b: -0.05, c: 0.0 } }),
      rules: [onlyB],
      now: FIXED_NOW,
    });

    // Case `b` didn't cross threshold; `a` is excluded by filter.
    expect(result.fired).toHaveLength(0);
  });

  it('skips disabled rules with the `disabled` outcome', async () => {
    const router = new AlertRouter(new Map());
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule({ enabled: false })],
      now: FIXED_NOW,
    });
    expect(result.decisions[0].outcome).toBe('disabled');
    expect(result.fired).toHaveLength(0);
  });

  it('skips rules whose suiteId does not match the run', async () => {
    const router = new AlertRouter(new Map());
    const result = await router.evaluate({
      run: makeRun({ suiteId: 'suite-other' }),
      deltas: makeDeltas(),
      rules: [rule({ suiteId: 'suite-a' })],
      now: FIXED_NOW,
    });
    expect(result.decisions[0].outcome).toBe('suite-mismatch');
  });

  it('matches all-suites rule when suiteId is unset', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule({ suiteId: undefined })],
      now: FIXED_NOW,
    });
    expect(result.fired).toHaveLength(1);
  });

  it('treats null suiteId on a rule as catch-all', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule({ suiteId: null })],
      now: FIXED_NOW,
    });
    expect(result.fired).toHaveLength(1);
  });
});

// ─── dedupe (one rule × one run = one fire) ─────────────────────────────

describe('AlertRouter — dedupe', () => {
  it('does not double-fire when a single run matches two rules (cross-rule fan-out)', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [
        rule({ id: 'r1', name: 'Rule 1' }),
        rule({ id: 'r2', name: 'Rule 2' }),
      ],
      now: FIXED_NOW,
    });

    // Two rules, one run, two events — one per rule. The DB-level
    // UNIQUE constraint on (rule_id, run_id) is what blocks repeat
    // calls; within a single evaluate() each rule is visited once.
    expect(result.fired).toHaveLength(2);
    expect(result.fired.map((d) => d.ruleId).sort()).toEqual(['r1', 'r2']);
    expect(slack.calls).toHaveLength(2);
  });

  it('emits one decision per rule even when multiple cases trip the predicate', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
    });

    // 2 regressed cases (a, b) but only 1 fire — that's the dedupe contract.
    expect(result.fired).toHaveLength(1);
  });

  it('fires the same rule twice across two runs (cross-run fan-in)', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    const r = rule();

    const r1 = await router.evaluate({
      run: makeRun({ id: 'run-1' }),
      deltas: makeDeltas(),
      rules: [r],
      now: FIXED_NOW,
    });
    const r2 = await router.evaluate({
      run: makeRun({ id: 'run-2' }),
      deltas: makeDeltas(),
      rules: [r],
      now: FIXED_NOW,
    });

    expect(r1.fired).toHaveLength(1);
    expect(r2.fired).toHaveLength(1);
    expect(r1.fired[0].payload?.runId).toBe('run-1');
    expect(r2.fired[0].payload?.runId).toBe('run-2');
  });
});

// ─── cooldown ───────────────────────────────────────────────────────────

describe('AlertRouter — cooldown', () => {
  it('skips a rule whose last-fire is within the cooldown window', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    const r = rule({ cooldownMinutes: 30 });

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [r],
      lastFiredAt: new Map([
        [r.id, new Date(FIXED_NOW.getTime() - 10 * 60_000)], // 10 min ago
      ]),
      now: FIXED_NOW,
    });

    expect(result.decisions[0].outcome).toBe('cooldown');
    expect(result.decisions[0].reason).toMatch(/cooldown 30m active/);
    expect(slack.send).not.toHaveBeenCalled();
  });

  it('fires after the cooldown window has fully elapsed', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    const r = rule({ cooldownMinutes: 30 });

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [r],
      lastFiredAt: new Map([
        [r.id, new Date(FIXED_NOW.getTime() - 31 * 60_000)],
      ]),
      now: FIXED_NOW,
    });

    expect(result.fired).toHaveLength(1);
  });

  it('treats cooldown=0 as disabled (always fires regardless of lastFiredAt)', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    const r = rule({ cooldownMinutes: 0 });

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [r],
      lastFiredAt: new Map([
        [r.id, new Date(FIXED_NOW.getTime() - 1_000)], // 1s ago
      ]),
      now: FIXED_NOW,
    });

    expect(result.fired).toHaveLength(1);
  });

  it('fires when the rule has never fired before (no entry in lastFiredAt)', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule({ cooldownMinutes: 30 })],
      lastFiredAt: new Map(), // empty
      now: FIXED_NOW,
    });

    expect(result.fired).toHaveLength(1);
  });
});

// ─── trigger types ──────────────────────────────────────────────────────

describe('AlertRouter — avg-score-drop', () => {
  it('fires when the derived baseline avg drops by more than the threshold', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    // current avg 0.667, deltas average -0.166, baseline avg 0.833 → drop 0.166
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [
        rule({ id: 'avg', trigger: { type: 'avg-score-drop', threshold: 0.1 } }),
      ],
      now: FIXED_NOW,
    });

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].reason).toMatch(/dropped/i);
  });

  it('does not fire when the drop is below the threshold', async () => {
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas({ deltas: { a: -0.02, b: 0.01, c: 0.0 } }),
      rules: [rule({ trigger: { type: 'avg-score-drop', threshold: 0.1 } })],
      now: FIXED_NOW,
    });
    expect(result.fired).toHaveLength(0);
  });

  it('does not fire when no case has a baseline (nothing to compare to)', async () => {
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas({
        deltas: {},
        missingBaselines: ['a', 'b', 'c'],
        regressions: [],
      }),
      rules: [rule({ trigger: { type: 'avg-score-drop', threshold: 0.1 } })],
      now: FIXED_NOW,
    });
    expect(result.fired).toHaveLength(0);
  });
});

describe('AlertRouter — unsupported triggers', () => {
  it('skips provider-divergence with an explanatory reason', async () => {
    const router = new AlertRouter(new Map());
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [
        rule({ trigger: { type: 'provider-divergence', threshold: 0.1 } }),
      ],
      now: FIXED_NOW,
    });
    expect(result.decisions[0].outcome).toBe('unsupported-trigger');
    expect(result.decisions[0].reason).toMatch(/compare/);
  });

  it('skips schedule triggers with an explanatory reason', async () => {
    const router = new AlertRouter(new Map());
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule({ trigger: { type: 'schedule', cron: '0 9 * * 1' } })],
      now: FIXED_NOW,
    });
    expect(result.decisions[0].outcome).toBe('unsupported-trigger');
    expect(result.decisions[0].reason).toMatch(/cron/);
  });
});

// ─── exclusions: no evaluator-error / missing-baseline alerts ──────────

describe('AlertRouter — exclusions', () => {
  it('does not fire on cases marked noScore (NaN scores never look like regressions)', async () => {
    // arch §6: computeDeltas treats NaN current scores as NO_SCORE, never REGRESSION
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas({
        deltas: { a: -0.5, b: 0.0, c: 0.0 },
        regressions: [],
        noScore: ['a'],
      }),
      rules: [rule()],
      now: FIXED_NOW,
    });
    expect(result.fired).toHaveLength(0);
  });

  it('does not fire on cases without a baseline (first-time runs)', async () => {
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas({
        deltas: { a: -0.5, b: 0.0, c: 0.0 },
        regressions: [],
        missingBaselines: ['a'],
      }),
      rules: [rule()],
      now: FIXED_NOW,
    });
    expect(result.fired).toHaveLength(0);
  });

  it('does not fire on stale-baseline cases (suiteHash drift is its own warning)', async () => {
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas({
        deltas: { a: -0.5, b: 0.0, c: 0.0 },
        regressions: [],
        staleBaselines: ['a'],
      }),
      rules: [rule()],
      now: FIXED_NOW,
    });
    expect(result.fired).toHaveLength(0);
  });
});

// ─── dispatch + delivery outcomes ───────────────────────────────────────

describe('AlertRouter — dispatch', () => {
  it('records `delivered` for a sender that resolves', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
    });

    expect(result.fired[0].deliveries).toEqual([
      expect.objectContaining({ type: 'slack', status: 'delivered' }),
    ]);
  });

  it('records `failed` with the error message when a sender throws', async () => {
    const failing = new FailingSender();
    const router = new AlertRouter(senderRegistry(['slack', failing]));

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
    });

    expect(result.fired[0].deliveries?.[0]).toMatchObject({
      type: 'slack',
      status: 'failed',
      error: 'boom',
    });
  });

  it('records `skipped` with `no-sender` when no sender is registered for the channel type', async () => {
    const router = new AlertRouter(new Map());
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
    });
    expect(result.fired[0].deliveries?.[0]).toMatchObject({
      type: 'slack',
      status: 'skipped',
      error: 'no-sender',
    });
  });

  it('isolates failures across channels — Slack delivers even when webhook fails', async () => {
    const slack = new CapturingSender();
    const webhook = new FailingSender();
    const router = new AlertRouter(
      senderRegistry(['slack', slack], ['webhook', webhook]),
    );

    const r = rule({
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
        { type: 'webhook', config: { url: 'https://receiver.example.com/x' } },
      ],
    });

    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [r],
      now: FIXED_NOW,
    });

    const statuses = result.fired[0].deliveries?.map((d) => `${d.type}:${d.status}`).sort();
    expect(statuses).toEqual(['slack:delivered', 'webhook:failed']);
  });
});

// ─── payload contract ──────────────────────────────────────────────────

describe('AlertRouter — payload', () => {
  it('builds a payload that matches the AlertPayload schema', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));

    await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
      runUrlBuilder: (run) => `https://drift.example.com/runs/${run.id}`,
    });

    const p = slack.calls[0].payload;
    expect(p.version).toBe(1);
    expect(p.ruleId).toBe('rule-1');
    expect(p.runId).toBe('run-1');
    expect(p.runUrl).toBe('https://drift.example.com/runs/run-1');
    expect(p.suiteId).toBe('suite-a');
    expect(p.provider).toBe('anthropic/claude-sonnet-4-5');
    expect(p.firedAt).toEqual(FIXED_NOW);
    expect(p.regressions.map((r) => r.caseId).sort()).toEqual(['a', 'b']);
  });

  it('omits runUrl when no builder is provided', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
    });
    expect(slack.calls[0].payload.runUrl).toBeUndefined();
  });

  it('records a delivery durationMs that is a non-negative integer', async () => {
    const slack = new CapturingSender();
    const router = new AlertRouter(senderRegistry(['slack', slack]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [rule()],
      now: FIXED_NOW,
    });
    const dur = result.fired[0].deliveries?.[0].durationMs;
    expect(typeof dur).toBe('number');
    expect(dur).toBeGreaterThanOrEqual(0);
  });
});

// ─── ordering / multi-rule mix ──────────────────────────────────────────

describe('AlertRouter — multi-rule', () => {
  it('preserves rule input order in decisions', async () => {
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [
        rule({ id: 'r3' }),
        rule({ id: 'r1', enabled: false }),
        rule({ id: 'r2', suiteId: 'suite-other' }),
      ],
      now: FIXED_NOW,
    });
    expect(result.decisions.map((d) => d.ruleId)).toEqual(['r3', 'r1', 'r2']);
  });

  it('returns `fired` as a strict subset of `decisions`', async () => {
    const router = new AlertRouter(senderRegistry(['slack', new CapturingSender()]));
    const result = await router.evaluate({
      run: makeRun(),
      deltas: makeDeltas(),
      rules: [
        rule({ id: 'r1' }),
        rule({ id: 'r2', enabled: false }),
        rule({ id: 'r3', suiteId: 'other' }),
      ],
      now: FIXED_NOW,
    });
    expect(result.decisions).toHaveLength(3);
    expect(result.fired).toHaveLength(1);
    expect(result.fired[0].ruleId).toBe('r1');
  });
});
