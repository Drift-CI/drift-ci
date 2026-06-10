import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * GitHub webhook signature verification.
 *
 * GitHub signs the raw request body with HMAC-SHA256 using the
 * webhook secret you configure in the repository / org settings:
 *   X-Hub-Signature-256: sha256=<hex>
 *
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 *
 * The check MUST run against the raw bytes — re-serialising via
 * JSON.parse + JSON.stringify will produce different bytes (key
 * order, whitespace) and never match.
 */

export type WebhookVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'no-secret-configured'
        | 'missing-signature'
        | 'malformed-signature'
        | 'bad-signature';
    };

export function verifyGitHubSignature(
  body: string,
  signatureHeader: string | null | undefined,
  secret: string | undefined,
): WebhookVerifyResult {
  if (!secret) return { ok: false, reason: 'no-secret-configured' };
  if (!signatureHeader) return { ok: false, reason: 'missing-signature' };

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signatureHeader.trim());
  if (!match) return { ok: false, reason: 'malformed-signature' };
  const supplied = match[1];

  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');

  // Decode both to bytes for the timing-safe compare. Lengths match by
  // construction (both are 64-char hex), so the buffer cmp is safe.
  const a = Buffer.from(supplied, 'hex');
  const b = Buffer.from(expected, 'hex');
  /* c8 ignore next */
  if (a.length === 0 || a.length !== b.length) return { ok: false, reason: 'malformed-signature' };

  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'bad-signature' };
}

/**
 * Lightweight envelope around the parsed webhook payload. Concrete
 * event handlers will land alongside Phase 4 alerting; for M21b we
 * simply audit the event shape.
 */
export interface WebhookEnvelope {
  event: string;
  deliveryId: string;
  body: unknown;
}

export function readEnvelope(headers: Headers, body: unknown): WebhookEnvelope {
  return {
    event: headers.get('x-github-event') ?? 'unknown',
    deliveryId: headers.get('x-github-delivery') ?? 'unknown',
    body,
  };
}
