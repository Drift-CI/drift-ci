import { describe, it, expect, vi } from 'vitest';

import {
  PAGERDUTY_EVENTS_URL,
  PagerDutySender,
  buildPagerDutyEvent,
} from '../pagerduty.js';
import type { AlertChannel, AlertPayload } from '../../types/alerts.js';

function payload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    version: 1,
    ruleId: 'rule-1',
    ruleName: 'Production regressions',
    reason: '2 case(s) regressed by >15.0%',
    runId: 'run-1',
    runUrl: 'https://drift.example.com/runs/run-1',
    suiteId: 'suite-a',
    provider: 'anthropic/claude-sonnet-4-5',
    startedAt: new Date('2026-04-25T11:55:00Z'),
    avgScore: 0.667,
    regressions: [
      { caseId: 'a', score: 0.5, delta: -0.3 },
      { caseId: 'b', score: 0.6, delta: -0.2 },
    ],
    firedAt: new Date('2026-04-25T12:00:00Z'),
    ...overrides,
  };
}

const pdChannel: AlertChannel = {
  type: 'pagerduty',
  config: { routingKey: 'R0123456789ABCDEF', severity: 'error' },
};

function captureFetch(response = new Response(null, { status: 202 })) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

// ─── sender ─────────────────────────────────────────────────────────────

describe('PagerDutySender', () => {
  it('throws when handed a non-pagerduty channel (router contract)', async () => {
    const sender = new PagerDutySender({ fetch: captureFetch().fetch });
    await expect(
      sender.send({ type: 'slack', config: { webhookUrl: 'https://x' } }, payload()),
    ).rejects.toThrow(/non-pagerduty channel/);
  });

  it('POSTs to the v2 events endpoint by default', async () => {
    const { fetch, calls } = captureFetch();
    const sender = new PagerDutySender({ fetch });
    await sender.send(pdChannel, payload());
    expect(calls[0].url).toBe(PAGERDUTY_EVENTS_URL);
    expect(calls[0].init?.method).toBe('POST');
  });

  it('routes to a custom events endpoint (e.g. EU instance)', async () => {
    const { fetch, calls } = captureFetch();
    const sender = new PagerDutySender({
      fetch,
      eventsUrl: 'https://events.eu.pagerduty.com/v2/enqueue',
    });
    await sender.send(pdChannel, payload());
    expect(calls[0].url).toBe('https://events.eu.pagerduty.com/v2/enqueue');
  });

  it('accepts the full 2xx range as success (PagerDuty returns 202)', async () => {
    const { fetch } = captureFetch(new Response(null, { status: 202 }));
    const sender = new PagerDutySender({ fetch });
    await expect(sender.send(pdChannel, payload())).resolves.toBeUndefined();
  });

  it('throws on non-2xx so the router records failed', async () => {
    const fail = captureFetch(new Response(null, { status: 401, statusText: 'Unauthorized' }));
    const sender = new PagerDutySender({ fetch: fail.fetch });
    await expect(sender.send(pdChannel, payload())).rejects.toThrow(/401/);
  });
});

// ─── event builder ──────────────────────────────────────────────────────

describe('buildPagerDutyEvent', () => {
  it('emits a `trigger` event with the routing key', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload());
    expect(ev.event_action).toBe('trigger');
    expect(ev.routing_key).toBe('R0123');
  });

  it('uses alertDedupeKey for dedup_key (mirrors arch §14)', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload());
    expect(ev.dedup_key).toBe('rule-1::run-1');
  });

  it('threads severity through verbatim', () => {
    const ev = buildPagerDutyEvent('R0123', 'critical', payload());
    expect(ev.payload.severity).toBe('critical');
  });

  it('packs the rule name and reason into `summary`', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload());
    expect(ev.payload.summary).toContain('Production regressions');
    expect(ev.payload.summary).toContain('regressed by');
  });

  it('truncates summary at 1024 chars (PagerDuty hard limit)', () => {
    const longReason = 'X'.repeat(2000);
    const ev = buildPagerDutyEvent('R0123', 'error', payload({ reason: longReason }));
    expect(ev.payload.summary.length).toBeLessThanOrEqual(1024);
    expect(ev.payload.summary.endsWith('...')).toBe(true);
  });

  it('sets source / component / group / class to drift-ci semantics', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload());
    expect(ev.payload.source).toBe('drift-ci');
    expect(ev.payload.component).toBe('suite-a');
    expect(ev.payload.group).toBe('anthropic/claude-sonnet-4-5');
    expect(ev.payload.class).toBe('regression');
  });

  it('includes structured custom_details for receivers that want the full payload', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload());
    expect(ev.payload.custom_details).toMatchObject({
      ruleId: 'rule-1',
      runId: 'run-1',
      suiteId: 'suite-a',
      avgScore: 0.667,
      regressions: expect.arrayContaining([
        expect.objectContaining({ caseId: 'a' }),
      ]),
    });
  });

  it('serialises Date fields in custom_details as ISO strings', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload());
    const details = ev.payload.custom_details as Record<string, unknown>;
    expect(details.firedAt).toBe('2026-04-25T12:00:00.000Z');
    expect(details.startedAt).toBe('2026-04-25T11:55:00.000Z');
  });

  it('attaches a links[0] when runUrl is set', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload());
    expect(ev.links).toEqual([
      { href: 'https://drift.example.com/runs/run-1', text: 'View run' },
    ]);
  });

  it('omits links entirely when runUrl is missing', () => {
    const ev = buildPagerDutyEvent('R0123', 'error', payload({ runUrl: undefined }));
    expect(ev.links).toBeUndefined();
  });
});
