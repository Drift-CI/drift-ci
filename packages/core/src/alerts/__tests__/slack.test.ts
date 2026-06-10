import { describe, it, expect, vi } from 'vitest';

import { SlackSender, buildSlackBody } from '../slack.js';
import type { AlertChannel, AlertPayload } from '../../types/alerts.js';

function payload(overrides: Partial<AlertPayload> = {}): AlertPayload {
  return {
    version: 1,
    ruleId: 'r1',
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

const slackChannel: AlertChannel = {
  type: 'slack',
  config: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
};

function captureFetch(response = new Response(null, { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

// ─── sender ─────────────────────────────────────────────────────────────

describe('SlackSender', () => {
  it('throws when handed a non-slack channel', async () => {
    const sender = new SlackSender({ fetch: captureFetch().fetch });
    await expect(
      sender.send({ type: 'webhook', config: { url: 'https://x' } }, payload()),
    ).rejects.toThrow(/non-slack channel/);
  });

  it('POSTs JSON to the configured webhookUrl', async () => {
    const { fetch, calls } = captureFetch();
    const sender = new SlackSender({ fetch });
    await sender.send(slackChannel, payload());
    expect(calls[0].url).toBe('https://hooks.slack.com/services/T/B/X');
    expect(calls[0].init?.method).toBe('POST');
    expect((calls[0].init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('throws on non-2xx so the router records failed', async () => {
    const fail = captureFetch(new Response('no_text', { status: 400, statusText: 'Bad Request' }));
    const sender = new SlackSender({ fetch: fail.fetch });
    await expect(sender.send(slackChannel, payload())).rejects.toThrow(/400/);
  });
});

// ─── body builder ───────────────────────────────────────────────────────

describe('buildSlackBody', () => {
  it('always sets a fallback `text` for screen readers / mobile', () => {
    const body = buildSlackBody(payload());
    expect(body.text).toContain('drift-ci alert');
    expect(body.text).toContain('Production regressions');
  });

  it('opens with a header section carrying rule name and reason', () => {
    const body = buildSlackBody(payload());
    expect(body.blocks[0]).toMatchObject({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: expect.stringContaining('Production regressions'),
      },
    });
  });

  it('includes a 4-fact section: suite, provider, avg score, regression count', () => {
    const body = buildSlackBody(payload());
    const fields = body.blocks[1] as { type: 'section'; fields: Array<{ text: string }> };
    expect(fields.type).toBe('section');
    expect(fields.fields).toHaveLength(4);
    const flat = fields.fields.map((f) => f.text).join('|');
    expect(flat).toContain('Suite');
    expect(flat).toContain('suite-a');
    expect(flat).toContain('Provider');
    expect(flat).toContain('anthropic/claude-sonnet-4-5');
    expect(flat).toContain('Avg score');
    expect(flat).toContain('0.667');
    expect(flat).toContain('Regressions');
  });

  it('lists per-case regressions with caseId, score, and delta', () => {
    const body = buildSlackBody(payload());
    const regressionBlock = body.blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('Regressed cases'),
    ) as { text: { text: string } } | undefined;
    expect(regressionBlock).toBeDefined();
    expect(regressionBlock?.text.text).toContain('`a`');
    expect(regressionBlock?.text.text).toContain('0.500');
    expect(regressionBlock?.text.text).toMatch(/Δ.+-0\.300/);
    expect(regressionBlock?.text.text).toContain('`b`');
  });

  it('truncates long regression lists with a "+N more" tail', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      caseId: `case-${i}`,
      score: 0.5,
      delta: -0.2,
    }));
    const body = buildSlackBody(payload({ regressions: many }), 5);
    const block = body.blocks.find(
      (b) => b.type === 'section' && b.text?.text?.includes('Regressed cases'),
    ) as { text: { text: string } };
    expect(block.text.text).toMatch(/_…and 20 more_/);
  });

  it('appends a "View run" actions block when runUrl is set', () => {
    const body = buildSlackBody(payload());
    const last = body.blocks.at(-1) as { type: string; elements: Array<{ url: string }> };
    expect(last.type).toBe('actions');
    expect(last.elements[0].url).toBe('https://drift.example.com/runs/run-1');
  });

  it('omits the actions block entirely when runUrl is missing (Slack rejects empty URLs)', () => {
    const body = buildSlackBody(payload({ runUrl: undefined }));
    const hasActions = body.blocks.some((b) => b.type === 'actions');
    expect(hasActions).toBe(false);
  });

  it('omits the regression-list section when there are no regressions', () => {
    const body = buildSlackBody(payload({ regressions: [] }));
    const hasRegressionBlock = body.blocks.some(
      (b) => b.type === 'section' && b.text?.text?.includes('Regressed cases'),
    );
    expect(hasRegressionBlock).toBe(false);
  });
});
