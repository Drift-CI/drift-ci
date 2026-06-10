import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  AlertChannelSchema,
  AlertTriggerSchema,
} from '@drift-ci/core/types';

import { createAlertRule, listAlertRules } from '@/lib/alert-rules';
import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { checkOrigin } from '@/lib/origin';
import { rateLimit } from '@/lib/rate-limit';
import { requireAuth } from '@/lib/route-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/alert-rules — list rules visible to the caller.
 * Scope: `alerts:manage` (member + admin). Viewers cannot see rule
 * configs (they may include channel URLs / secrets).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'alerts:manage' });
  if (auth instanceof NextResponse) return auth;

  const db = getDb();
  const rules = await listAlertRules(db);
  return NextResponse.json({ ok: true, rules });
}

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  suiteId: z.string().min(1).nullable().optional(),
  trigger: AlertTriggerSchema,
  channels: z.array(AlertChannelSchema).min(1),
  cooldownMinutes: z.number().int().min(0).max(7 * 24 * 60).optional(),
  enabled: z.boolean().optional(),
});

/**
 * POST /api/v1/alert-rules — create a rule.
 *
 * The full discriminated trigger + channels schema from
 * @drift-ci/core is reused, so callers get the same per-channel
 * config validation the YAML loader does. A typo'd webhook URL
 * fails here, not later as a 4xx during a regression.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireAuth(request, { requiredScope: 'alerts:manage' });
  if (auth instanceof NextResponse) return auth;

  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, error: `forbidden: ${origin.reason}` },
      { status: 403 },
    );
  }

  const limited = await rateLimit({
    key: `alert-rules:${auth.tokenId}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((limited.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { ok: false, error: 'rate-limited' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    );
  }

  let parsed: z.infer<typeof CreateBody>;
  try {
    const json = await request.json();
    parsed = CreateBody.parse(json);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bad-body';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 400 },
    );
  }

  const db = getDb();
  const rule = await createAlertRule(db, {
    name: parsed.name,
    suiteId: parsed.suiteId ?? null,
    trigger: parsed.trigger,
    channels: parsed.channels,
    cooldownMinutes: parsed.cooldownMinutes,
    enabled: parsed.enabled,
    createdBy: auth.userId,
  });

  await recordAudit(db, {
    userId: auth.userId,
    tokenId: auth.tokenId,
    kind: AUDIT_KINDS.ALERT_RULE_CREATED,
    target: rule.id,
    data: {
      name: rule.name,
      triggerType: rule.trigger.type,
      channelTypes: rule.channels.map((c) => c.type),
      via: 'api',
    },
  });

  return NextResponse.json({ ok: true, rule }, { status: 201 });
}
