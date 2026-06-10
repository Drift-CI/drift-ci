import { describe, it, expect } from 'vitest';

import {
  ALERT_TRIGGER_TYPES,
  AlertChannelSchema,
  AlertEventSchema,
  AlertPayloadSchema,
  AlertRuleSchema,
  AlertTriggerSchema,
  alertDedupeKey,
} from '../alerts.js';

// ─── triggers ───────────────────────────────────────────────────────────

describe('AlertTriggerSchema', () => {
  it('exports the canonical trigger-type list', () => {
    expect(ALERT_TRIGGER_TYPES).toEqual([
      'regression-threshold',
      'avg-score-drop',
      'provider-divergence',
      'schedule',
    ]);
  });

  it('parses a regression-threshold trigger', () => {
    const out = AlertTriggerSchema.parse({
      type: 'regression-threshold',
      threshold: 0.15,
    });
    expect(out).toMatchObject({ type: 'regression-threshold', threshold: 0.15 });
  });

  it('parses a regression-threshold with case filter', () => {
    const out = AlertTriggerSchema.parse({
      type: 'regression-threshold',
      threshold: 0.1,
      caseId: 'classify/edge',
    });
    expect(out).toMatchObject({ caseId: 'classify/edge' });
  });

  it('rejects threshold > 1', () => {
    expect(() =>
      AlertTriggerSchema.parse({ type: 'regression-threshold', threshold: 1.5 }),
    ).toThrow();
  });

  it('rejects threshold < 0', () => {
    expect(() =>
      AlertTriggerSchema.parse({ type: 'regression-threshold', threshold: -0.1 }),
    ).toThrow();
  });

  it('rejects threshold trigger missing threshold', () => {
    expect(() =>
      AlertTriggerSchema.parse({ type: 'avg-score-drop' }),
    ).toThrow();
  });

  it('parses a schedule trigger with cron', () => {
    const out = AlertTriggerSchema.parse({
      type: 'schedule',
      cron: '0 9 * * 1',
    });
    expect(out).toMatchObject({ type: 'schedule', cron: '0 9 * * 1' });
  });

  it('rejects schedule trigger missing cron', () => {
    expect(() =>
      AlertTriggerSchema.parse({ type: 'schedule' }),
    ).toThrow();
  });

  it('rejects schedule trigger with empty cron', () => {
    expect(() =>
      AlertTriggerSchema.parse({ type: 'schedule', cron: '' }),
    ).toThrow();
  });

  it('rejects an unknown trigger type', () => {
    expect(() =>
      AlertTriggerSchema.parse({ type: 'something-else', threshold: 0.1 }),
    ).toThrow();
  });
});

// ─── channels ───────────────────────────────────────────────────────────

describe('AlertChannelSchema', () => {
  it('parses a valid Slack channel', () => {
    const out = AlertChannelSchema.parse({
      type: 'slack',
      config: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
    });
    expect(out.type).toBe('slack');
  });

  it('rejects Slack channel with non-URL webhook', () => {
    expect(() =>
      AlertChannelSchema.parse({
        type: 'slack',
        config: { webhookUrl: 'not-a-url' },
      }),
    ).toThrow();
  });

  it('parses a valid Teams channel', () => {
    const out = AlertChannelSchema.parse({
      type: 'teams',
      config: { webhookUrl: 'https://outlook.office.com/webhook/abc' },
    });
    expect(out.type).toBe('teams');
  });

  it('parses a PagerDuty channel and applies the default severity', () => {
    const out = AlertChannelSchema.parse({
      type: 'pagerduty',
      config: { routingKey: 'R0123456789' },
    });
    if (out.type !== 'pagerduty') throw new Error('discriminant');
    expect(out.config.severity).toBe('error');
  });

  it('honours an explicit PagerDuty severity', () => {
    const out = AlertChannelSchema.parse({
      type: 'pagerduty',
      config: { routingKey: 'R0123456789', severity: 'critical' },
    });
    if (out.type !== 'pagerduty') throw new Error('discriminant');
    expect(out.config.severity).toBe('critical');
  });

  it('rejects PagerDuty channel with unknown severity', () => {
    expect(() =>
      AlertChannelSchema.parse({
        type: 'pagerduty',
        config: { routingKey: 'R', severity: 'meh' },
      }),
    ).toThrow();
  });

  it('parses a webhook channel without a signing secret', () => {
    const out = AlertChannelSchema.parse({
      type: 'webhook',
      config: { url: 'https://drift-receiver.example.com/hook' },
    });
    expect(out.type).toBe('webhook');
  });

  it('rejects webhook channel with a too-short signing secret', () => {
    expect(() =>
      AlertChannelSchema.parse({
        type: 'webhook',
        config: { url: 'https://x.example.com', signingSecret: 'short' },
      }),
    ).toThrow();
  });

  it('parses an email channel', () => {
    const out = AlertChannelSchema.parse({
      type: 'email',
      config: { to: 'oncall@example.com' },
    });
    expect(out.type).toBe('email');
  });

  it('rejects an email channel with malformed address', () => {
    expect(() =>
      AlertChannelSchema.parse({
        type: 'email',
        config: { to: 'not-an-email' },
      }),
    ).toThrow();
  });

  it('rejects an unknown channel type', () => {
    expect(() =>
      AlertChannelSchema.parse({
        type: 'sms',
        config: { phone: '+15551234' },
      }),
    ).toThrow();
  });
});

// ─── rules ──────────────────────────────────────────────────────────────

describe('AlertRuleSchema', () => {
  const baseRule = {
    id: 'rule-1',
    name: 'Production regressions',
    trigger: { type: 'regression-threshold', threshold: 0.1 },
    channels: [
      { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
    ],
  };

  it('parses a minimal rule and applies enabled+cooldown defaults', () => {
    const out = AlertRuleSchema.parse(baseRule);
    expect(out.enabled).toBe(true);
    expect(out.cooldownMinutes).toBe(0);
  });

  it('rejects a rule with no channels', () => {
    expect(() =>
      AlertRuleSchema.parse({ ...baseRule, channels: [] }),
    ).toThrow();
  });

  it('honours an explicit cooldown', () => {
    const out = AlertRuleSchema.parse({ ...baseRule, cooldownMinutes: 30 });
    expect(out.cooldownMinutes).toBe(30);
  });

  it('caps cooldown at one week', () => {
    expect(() =>
      AlertRuleSchema.parse({ ...baseRule, cooldownMinutes: 7 * 24 * 60 + 1 }),
    ).toThrow();
  });

  it('rejects negative cooldown', () => {
    expect(() =>
      AlertRuleSchema.parse({ ...baseRule, cooldownMinutes: -5 }),
    ).toThrow();
  });

  it('parses a rule with a null suiteId (catch-all)', () => {
    const out = AlertRuleSchema.parse({ ...baseRule, suiteId: null });
    expect(out.suiteId).toBeNull();
  });

  it('parses a rule with multiple channels of mixed types', () => {
    const out = AlertRuleSchema.parse({
      ...baseRule,
      channels: [
        { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
        {
          type: 'webhook',
          config: {
            url: 'https://receiver.example.com/hook',
            signingSecret: 'a-very-long-shared-secret',
          },
        },
        { type: 'email', config: { to: 'oncall@example.com' } },
      ],
    });
    expect(out.channels).toHaveLength(3);
  });
});

// ─── payload ────────────────────────────────────────────────────────────

describe('AlertPayloadSchema', () => {
  const basePayload = {
    version: 1 as const,
    ruleId: 'rule-1',
    ruleName: 'Production regressions',
    reason: '2 case(s) regressed by >15%',
    runId: 'run-uuid-123',
    suiteId: 'suite-a',
    provider: 'anthropic/claude-sonnet-4-5',
    startedAt: new Date('2026-04-25T10:00:00Z'),
    avgScore: 0.82,
    regressions: [
      { caseId: 'a', score: 0.5, delta: -0.3 },
      { caseId: 'b', score: 0.6, delta: -0.2 },
    ],
    firedAt: new Date('2026-04-25T10:05:00Z'),
  };

  it('parses a complete payload', () => {
    const out = AlertPayloadSchema.parse(basePayload);
    expect(out.regressions).toHaveLength(2);
  });

  it('coerces ISO date strings to Date instances', () => {
    const out = AlertPayloadSchema.parse({
      ...basePayload,
      startedAt: '2026-04-25T10:00:00Z',
      firedAt: '2026-04-25T10:05:00Z',
    });
    expect(out.startedAt).toBeInstanceOf(Date);
    expect(out.firedAt).toBeInstanceOf(Date);
  });

  it('rejects payload with version != 1', () => {
    expect(() =>
      AlertPayloadSchema.parse({ ...basePayload, version: 2 }),
    ).toThrow();
  });

  it('accepts an empty regressions list (schedule-fire payloads)', () => {
    const out = AlertPayloadSchema.parse({ ...basePayload, regressions: [] });
    expect(out.regressions).toHaveLength(0);
  });

  it('rejects a non-URL runUrl', () => {
    expect(() =>
      AlertPayloadSchema.parse({ ...basePayload, runUrl: 'not-a-url' }),
    ).toThrow();
  });
});

// ─── events ─────────────────────────────────────────────────────────────

describe('AlertEventSchema', () => {
  const baseEvent = {
    id: 'event-1',
    ruleId: 'rule-1',
    runId: 'run-1',
    reason: '2 case(s) regressed',
    payload: {
      version: 1 as const,
      ruleId: 'rule-1',
      ruleName: 'r',
      reason: '2 case(s) regressed',
      runId: 'run-1',
      suiteId: 's',
      provider: 'p',
      startedAt: new Date(),
      avgScore: 0.5,
      regressions: [],
      firedAt: new Date(),
    },
    deliveries: [{ type: 'slack', status: 'delivered', durationMs: 130 }],
    firedAt: new Date(),
  };

  it('parses a complete event', () => {
    const out = AlertEventSchema.parse(baseEvent);
    expect(out.deliveries[0].status).toBe('delivered');
  });

  it('parses an event with empty deliveries (router writes the row first)', () => {
    const out = AlertEventSchema.parse({ ...baseEvent, deliveries: [] });
    expect(out.deliveries).toHaveLength(0);
  });

  it('rejects deliveries with unknown status', () => {
    expect(() =>
      AlertEventSchema.parse({
        ...baseEvent,
        deliveries: [{ type: 'slack', status: 'queued' }],
      }),
    ).toThrow();
  });

  it('captures error string on failed deliveries', () => {
    const out = AlertEventSchema.parse({
      ...baseEvent,
      deliveries: [{ type: 'webhook', status: 'failed', error: 'HTTP 503' }],
    });
    expect(out.deliveries[0].error).toBe('HTTP 503');
  });
});

// ─── helpers ────────────────────────────────────────────────────────────

describe('alertDedupeKey', () => {
  it('joins ruleId and runId with the documented separator', () => {
    expect(alertDedupeKey('rule-x', 'run-y')).toBe('rule-x::run-y');
  });

  it('is stable for the same inputs', () => {
    expect(alertDedupeKey('a', 'b')).toBe(alertDedupeKey('a', 'b'));
  });

  it('differs when ruleId differs', () => {
    expect(alertDedupeKey('a', 'b')).not.toBe(alertDedupeKey('a2', 'b'));
  });

  it('differs when runId differs', () => {
    expect(alertDedupeKey('a', 'b')).not.toBe(alertDedupeKey('a', 'b2'));
  });
});
