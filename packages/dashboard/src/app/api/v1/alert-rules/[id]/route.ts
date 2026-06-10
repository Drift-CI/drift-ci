import { NextResponse } from 'next/server';

import {
  deleteAlertRule,
  getAlertRule,
  toggleAlertRule,
} from '@/lib/alert-rules';
import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { checkOrigin } from '@/lib/origin';
import { requireAuth } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/v1/alert-rules/:id — fetch a single rule. */
export async function GET(request: Request, ctx: Ctx): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'alerts:manage' });
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;

  const db = getDb();
  const rule = await getAlertRule(db, id);
  if (!rule) {
    return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, rule });
}

/**
 * PATCH /api/v1/alert-rules/:id — toggle the `enabled` flag.
 *
 * The PATCH surface is intentionally narrow: only `enabled` flips
 * are accepted. Updating trigger / channels would change the rule's
 * meaning silently for already-fired alert_events; operators rotate
 * by deleting + recreating instead. M32 keeps this contract simple.
 */
export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'alerts:manage' });
  if (auth instanceof NextResponse) return auth;

  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, error: `forbidden: ${origin.reason}` },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  const db = getDb();
  const updated = await toggleAlertRule(db, id);
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
  }
  await recordAudit(db, {
    userId: auth.userId,
    tokenId: auth.tokenId,
    kind: AUDIT_KINDS.ALERT_RULE_TOGGLED,
    target: id,
    data: { enabled: updated.enabled, via: 'api' },
  });
  return NextResponse.json({ ok: true, rule: updated });
}

/** DELETE /api/v1/alert-rules/:id — drop the rule (cascades alert_events). */
export async function DELETE(request: Request, ctx: Ctx): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'alerts:manage' });
  if (auth instanceof NextResponse) return auth;

  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, error: `forbidden: ${origin.reason}` },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;
  const db = getDb();
  const removed = await deleteAlertRule(db, id);
  if (!removed) {
    return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
  }
  await recordAudit(db, {
    userId: auth.userId,
    tokenId: auth.tokenId,
    kind: AUDIT_KINDS.ALERT_RULE_DELETED,
    target: id,
    data: { name: removed.name, via: 'api' },
  });
  return NextResponse.json({ ok: true });
}
