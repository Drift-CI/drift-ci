import { describe, it, expect, vi } from 'vitest';

import { EmailSender, type EmailMessage, type EmailTransport } from '../email.js';
import { PagerDutySender } from '../pagerduty.js';
import { buildDefaultSenders } from '../senders.js';
import { SlackSender } from '../slack.js';
import { TeamsSender } from '../teams.js';
import { WebhookSender } from '../webhook.js';

describe('buildDefaultSenders', () => {
  it('registers webhook + slack + teams + pagerduty by default', () => {
    const senders = buildDefaultSenders();
    expect(Array.from(senders.keys()).sort()).toEqual([
      'pagerduty',
      'slack',
      'teams',
      'webhook',
    ]);
    expect(senders.get('webhook')).toBeInstanceOf(WebhookSender);
    expect(senders.get('slack')).toBeInstanceOf(SlackSender);
    expect(senders.get('teams')).toBeInstanceOf(TeamsSender);
    expect(senders.get('pagerduty')).toBeInstanceOf(PagerDutySender);
  });

  it('omits email by default (no transport configured)', () => {
    const senders = buildDefaultSenders();
    expect(senders.has('email')).toBe(false);
  });

  it('registers email when an EmailTransport is supplied', () => {
    const transport: EmailTransport = { send: async (_m: EmailMessage) => undefined };
    const senders = buildDefaultSenders({ email: { transport } });
    expect(senders.has('email')).toBe(true);
    expect(senders.get('email')).toBeInstanceOf(EmailSender);
  });

  it('threads a shared fetch override into all HTTP-based senders', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof globalThis.fetch;
    const senders = buildDefaultSenders({ fetch });

    const payload = {
      version: 1 as const,
      ruleId: 'r',
      ruleName: 'r',
      reason: 'r',
      runId: 'run-1',
      suiteId: 's',
      provider: 'p',
      startedAt: new Date(),
      avgScore: 0.5,
      regressions: [],
      firedAt: new Date(),
    };
    await senders.get('webhook')!.send(
      { type: 'webhook', config: { url: 'https://x.example.com' } },
      payload,
    );
    await senders.get('slack')!.send(
      { type: 'slack', config: { webhookUrl: 'https://hooks.slack.com/x' } },
      payload,
    );
    await senders.get('teams')!.send(
      { type: 'teams', config: { webhookUrl: 'https://outlook.office.com/x' } },
      payload,
    );
    await senders.get('pagerduty')!.send(
      { type: 'pagerduty', config: { routingKey: 'R0123', severity: 'error' } },
      payload,
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});
