import { NextResponse } from 'next/server';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { readEnvelope, verifyGitHubSignature } from '@/lib/webhook';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/webhooks/github
 *
 * GitHub-signed webhook receiver. Validates `X-Hub-Signature-256`
 * against `GITHUB_WEBHOOK_SECRET` over the raw body, records the
 * delivery in the audit log, and ACKs.
 *
 * Concrete event handlers (alerting on PR merge, etc.) land alongside
 * Phase 4. This route is the secure ingress point so those handlers
 * can plug in without re-doing crypto.
 *
 * No bearer auth — GitHub's HMAC signature IS the auth. The webhook
 * URL is public; only signed payloads make it past `verifyGitHubSignature`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const signatureHeader = request.headers.get('x-hub-signature-256');

  // Read once as text for HMAC; we'll JSON.parse from the same string
  // below to avoid double-buffering.
  const rawBody = await request.text();

  const verified = verifyGitHubSignature(rawBody, signatureHeader, secret);
  if (!verified.ok) {
    await recordAudit(getDb(), {
      kind: AUDIT_KINDS.WEBHOOK_REJECTED,
      data: {
        reason: verified.reason,
        deliveryId: request.headers.get('x-github-delivery'),
        event: request.headers.get('x-github-event'),
      },
    });
    const status = verified.reason === 'no-secret-configured' ? 503 : 401;
    return NextResponse.json(
      { ok: false, error: `webhook: ${verified.reason}` },
      { status },
    );
  }

  let parsed: unknown;
  try {
    parsed = rawBody.length === 0 ? {} : JSON.parse(rawBody);
  } catch (err) {
    /* c8 ignore next 4 -- GitHub never sends malformed JSON in practice. */
    return NextResponse.json(
      { ok: false, error: `webhook: invalid JSON — ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const envelope = readEnvelope(request.headers, parsed);
  await recordAudit(getDb(), {
    kind: AUDIT_KINDS.WEBHOOK_RECEIVED,
    target: envelope.deliveryId,
    data: { event: envelope.event },
  });

  // Phase 4 handlers attach here (alert dispatch on pull_request.closed,
  // baseline-changed reconciliation on push, etc.). Empty no-op for
  // M21b — recording the receipt is the goal.

  return NextResponse.json(
    { ok: true, event: envelope.event, deliveryId: envelope.deliveryId },
    { status: 200 },
  );
}
