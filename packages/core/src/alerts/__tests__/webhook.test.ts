import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';

import { WebhookSender, verifyWebhookSignature } from '../webhook.js';
import type { AlertChannel, AlertPayload } from '../../types/alerts.js';

const FIXED_NOW = new Date('2026-04-25T12:00:00Z');
const FIXED_TS = String(Math.floor(FIXED_NOW.getTime() / 1000));

function payload(): AlertPayload {
  return {
    version: 1,
    ruleId: 'r1',
    ruleName: 'r',
    reason: 'reason',
    runId: 'run-1',
    suiteId: 's',
    provider: 'p',
    startedAt: FIXED_NOW,
    avgScore: 0.5,
    regressions: [{ caseId: 'a', score: 0.3, delta: -0.4 }],
    firedAt: FIXED_NOW,
  };
}

function webhookChannel(signingSecret?: string): AlertChannel {
  return {
    type: 'webhook',
    config: { url: 'https://receiver.example.com/hook', signingSecret },
  };
}

function ok(): Response {
  return new Response(null, { status: 200 });
}

function captureFetch(response: Response = ok()): {
  fetch: typeof globalThis.fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

// ─── sender ─────────────────────────────────────────────────────────────

describe('WebhookSender', () => {
  it('throws when handed a non-webhook channel (router contract)', async () => {
    const sender = new WebhookSender({ fetch: captureFetch().fetch });
    await expect(
      sender.send({ type: 'slack', config: { webhookUrl: 'https://x' } }, payload()),
    ).rejects.toThrow(/non-webhook channel/);
  });

  it('POSTs JSON with Content-Type and User-Agent headers', async () => {
    const { fetch, calls } = captureFetch();
    const sender = new WebhookSender({ fetch, now: () => FIXED_NOW });
    await sender.send(webhookChannel(), payload());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://receiver.example.com/hook');
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['User-Agent']).toMatch(/^drift-ci\/1$/);
  });

  it('sends X-Drift-Timestamp on every call (signed or not)', async () => {
    const { fetch, calls } = captureFetch();
    const sender = new WebhookSender({ fetch, now: () => FIXED_NOW });
    await sender.send(webhookChannel(), payload());
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['X-Drift-Timestamp']).toBe(FIXED_TS);
  });

  it('omits X-Drift-Signature-256 when no signingSecret is configured', async () => {
    const { fetch, calls } = captureFetch();
    const sender = new WebhookSender({ fetch, now: () => FIXED_NOW });
    await sender.send(webhookChannel(/* no secret */), payload());
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers['X-Drift-Signature-256']).toBeUndefined();
  });

  it('signs body as HMAC-SHA256(secret, `${timestamp}.${body}`) when signingSecret is set', async () => {
    const { fetch, calls } = captureFetch();
    const secret = 'a-very-long-shared-secret-32-chars-min';
    const sender = new WebhookSender({ fetch, now: () => FIXED_NOW });
    await sender.send(webhookChannel(secret), payload());

    const body = calls[0].init?.body as string;
    const headers = calls[0].init?.headers as Record<string, string>;
    const expected = createHmac('sha256', secret)
      .update(`${FIXED_TS}.${body}`)
      .digest('hex');
    expect(headers['X-Drift-Signature-256']).toBe(`sha256=${expected}`);
  });

  it('throws on non-2xx response so the router records `failed`', async () => {
    const fetch500 = captureFetch(new Response('bad', { status: 503, statusText: 'Service Unavailable' })).fetch;
    const sender = new WebhookSender({ fetch: fetch500, now: () => FIXED_NOW });
    await expect(sender.send(webhookChannel(), payload())).rejects.toThrow(/503/);
  });

  it('survives the round-trip: signature signed by sender verifies on receiver', async () => {
    const { fetch, calls } = captureFetch();
    const secret = 'shared-secret-that-is-long-enough';
    const sender = new WebhookSender({ fetch, now: () => FIXED_NOW });
    await sender.send(webhookChannel(secret), payload());

    const body = calls[0].init?.body as string;
    const headers = calls[0].init?.headers as Record<string, string>;
    const verdict = verifyWebhookSignature(
      headers['X-Drift-Signature-256'],
      headers['X-Drift-Timestamp'],
      body,
      secret,
      { now: () => FIXED_NOW },
    );
    expect(verdict).toEqual({ ok: true });
  });
});

// ─── verifier ───────────────────────────────────────────────────────────

describe('verifyWebhookSignature', () => {
  const secret = 'shared-secret-that-is-long-enough';
  const body = JSON.stringify({ ok: true });
  const ts = FIXED_TS;
  const sig = `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`;

  it('accepts a valid signature within tolerance', () => {
    const v = verifyWebhookSignature(sig, ts, body, secret, { now: () => FIXED_NOW });
    expect(v).toEqual({ ok: true });
  });

  it('rejects a missing signature header', () => {
    const v = verifyWebhookSignature(null, ts, body, secret, { now: () => FIXED_NOW });
    expect(v).toEqual({ ok: false, reason: 'missing-header' });
  });

  it('rejects a missing timestamp header', () => {
    const v = verifyWebhookSignature(sig, null, body, secret, { now: () => FIXED_NOW });
    expect(v).toEqual({ ok: false, reason: 'missing-header' });
  });

  it('rejects a malformed timestamp', () => {
    const v = verifyWebhookSignature(sig, 'not-a-number', body, secret, {
      now: () => FIXED_NOW,
    });
    expect(v).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a malformed signature header (missing sha256= prefix)', () => {
    const v = verifyWebhookSignature('abcdef', ts, body, secret, { now: () => FIXED_NOW });
    expect(v).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a signature of wrong hex length', () => {
    const v = verifyWebhookSignature('sha256=abc', ts, body, secret, {
      now: () => FIXED_NOW,
    });
    expect(v).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a tampered signature (correct shape, wrong bytes)', () => {
    const wrong = 'sha256=' + '0'.repeat(64);
    const v = verifyWebhookSignature(wrong, ts, body, secret, { now: () => FIXED_NOW });
    expect(v).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a payload tampered after signing (signature no longer matches)', () => {
    const v = verifyWebhookSignature(sig, ts, body + 'tampered', secret, {
      now: () => FIXED_NOW,
    });
    expect(v).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a wrong secret', () => {
    const v = verifyWebhookSignature(sig, ts, body, 'a-different-shared-secret', {
      now: () => FIXED_NOW,
    });
    expect(v).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a stale timestamp (replay > 5 min by default)', () => {
    const future = new Date(FIXED_NOW.getTime() + 6 * 60_000);
    const v = verifyWebhookSignature(sig, ts, body, secret, { now: () => future });
    expect(v).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a future-skewed timestamp (clock spoofing)', () => {
    const past = new Date(FIXED_NOW.getTime() - 6 * 60_000);
    const v = verifyWebhookSignature(sig, ts, body, secret, { now: () => past });
    expect(v).toEqual({ ok: false, reason: 'expired' });
  });

  it('honours a custom toleranceSeconds', () => {
    const future = new Date(FIXED_NOW.getTime() + 60 * 60_000); // 1 h
    const v = verifyWebhookSignature(sig, ts, body, secret, {
      now: () => future,
      toleranceSeconds: 2 * 60 * 60, // 2 h tolerance
    });
    expect(v).toEqual({ ok: true });
  });
});
