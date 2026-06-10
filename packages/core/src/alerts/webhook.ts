import { createHmac, timingSafeEqual } from 'node:crypto';

import type { AlertChannel, AlertPayload } from '../types/alerts.js';
import type { AlertSender } from './base.js';

/**
 * Generic HMAC-signed webhook sender. (arch §14)
 *
 * Signing is opt-in via `channel.config.signingSecret` — Slack and
 * Teams use opaque URL tokens for auth, so they don't need this.
 * For custom receivers (alert-aggregation services, internal
 * webhooks-to-Jira bridges, etc.), HMAC-SHA256 with timestamp lets
 * the receiver reject replays and forgeries without trusting URL
 * secrecy.
 *
 * Wire format:
 *
 *   POST <config.url>
 *   Content-Type: application/json
 *   User-Agent: drift-ci/<payload.version>
 *   X-Drift-Timestamp: <unix seconds, signed>
 *   X-Drift-Signature-256: sha256=<hex(hmac)>           // only when signed
 *   <body = JSON.stringify(payload)>
 *
 *   signature = HMAC-SHA256(secret, `${timestamp}.${body}`)
 *
 * Receivers verify with {@link verifyWebhookSignature}, which
 * constant-time-compares the signature and rejects timestamps older
 * than the replay window (default 5 minutes).
 */

export interface WebhookSenderOptions {
  /** Override `globalThis.fetch` for tests / custom HTTP clients. */
  fetch?: typeof globalThis.fetch;
  /** Override the timestamp source for tests. Defaults to Date.now(). */
  now?: () => Date;
}

export class WebhookSender implements AlertSender {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => Date;

  constructor(opts: WebhookSenderOptions = {}) {
    this.fetcher = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? (() => new Date());
  }

  async send(channel: AlertChannel, payload: AlertPayload): Promise<void> {
    if (channel.type !== 'webhook') {
      throw new Error(
        `WebhookSender received non-webhook channel type "${channel.type}"`,
      );
    }
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(this.now().getTime() / 1000).toString();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': `drift-ci/${payload.version}`,
      'X-Drift-Timestamp': timestamp,
    };

    if (channel.config.signingSecret) {
      headers['X-Drift-Signature-256'] = `sha256=${signWebhookBody(
        channel.config.signingSecret,
        timestamp,
        body,
      )}`;
    }

    const res = await this.fetcher(channel.config.url, {
      method: 'POST',
      headers,
      body,
    });
    if (!res.ok) {
      throw new Error(`webhook POST ${channel.config.url} failed: ${res.status} ${res.statusText}`);
    }
  }
}

// ─── verifier (exported for receivers) ─────────────────────────────────

export interface VerifyWebhookOptions {
  /** Replay window in seconds. Default 300 (5 minutes), per arch §14. */
  toleranceSeconds?: number;
  /** Override "now" for tests. Defaults to Date.now(). */
  now?: () => Date;
}

export type VerifyWebhookResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'missing-header' | 'malformed' | 'bad-signature' | 'expired';
    };

/**
 * Receiver-side HMAC verifier. Mirrors the WebhookSender's signing
 * contract so a custom receiver can authenticate drift-ci alerts in
 * a few lines:
 *
 * ```ts
 * const sig = req.headers.get('x-drift-signature-256');
 * const ts  = req.headers.get('x-drift-timestamp');
 * const raw = await req.text();   // raw body, NOT JSON.parse + re-stringify
 * const v = verifyWebhookSignature(sig, ts, raw, secret);
 * if (!v.ok) return new Response('forbidden', { status: 403 });
 * ```
 *
 * Constant-time comparison via `crypto.timingSafeEqual` — never
 * `===` a signature. The 5-minute replay window matches the GitHub
 * webhook receiver in `packages/dashboard/src/lib/webhook.ts` so
 * operators have one mental model for "drift-ci HMAC freshness."
 */
export function verifyWebhookSignature(
  signatureHeader: string | null | undefined,
  timestampHeader: string | null | undefined,
  rawBody: string,
  secret: string,
  opts: VerifyWebhookOptions = {},
): VerifyWebhookResult {
  if (!signatureHeader || !timestampHeader) {
    return { ok: false, reason: 'missing-header' };
  }
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now?.() ?? new Date();

  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: 'malformed' };
  }
  const skewSec = Math.abs(Math.floor(now.getTime() / 1000) - ts);
  if (skewSec > tolerance) {
    return { ok: false, reason: 'expired' };
  }

  const match = signatureHeader.match(/^sha256=([0-9a-f]{64})$/i);
  if (!match) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = signWebhookBody(secret, timestampHeader, rawBody);
  const got = match[1];
  if (got.length !== expected.length) {
    return { ok: false, reason: 'bad-signature' };
  }
  const a = Buffer.from(got, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad-signature' };
  }
  return { ok: true };
}

// ─── private ───────────────────────────────────────────────────────────

function signWebhookBody(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}
