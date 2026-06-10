import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt } from 'drizzle-orm';

import type { Db } from './db';
import { auditEvents, type AuditEvent } from './schema';

/**
 * Append-only audit-log writer.
 *
 * Failures are deliberately swallowed: a downed audit table must not
 * cascade into a 500 on the user-facing call. Operators see audit
 * outages via the `/admin/audit` page going stale and via the dashboard
 * health check (M21b will probe this).
 */

export interface AuditEventInput {
  userId?: string | null;
  tokenId?: string | null;
  kind: string;
  target?: string | null;
  data?: Record<string, unknown>;
  occurredAt?: Date;
}

export async function recordAudit(
  db: Db,
  input: AuditEventInput,
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      id: randomUUID(),
      userId: input.userId ?? null,
      tokenId: input.tokenId ?? null,
      kind: input.kind,
      target: input.target ?? null,
      data: input.data ?? {},
      occurredAt: input.occurredAt,
    });
  } catch {
    // Best-effort. If we ever care about audit-write failures, M21b's
    // dashboard health-check will catch a stale `audit_events` table.
    /* c8 ignore next */
  }
}

// ─── known kinds ────────────────────────────────────────────────────────
//
// Centralised so route handlers + server actions reference the same
// strings. Keep this list short — the UI groups + colours by kind, and
// every new kind needs a corresponding entry in `auditKindLabel()`.

export const AUDIT_KINDS = {
  USER_SIGNED_IN: 'user.signed-in',
  USER_SIGNED_OUT: 'user.signed-out',
  AUTH_FAILED: 'auth.failed',
  TOKEN_MINTED: 'token.minted',
  TOKEN_REVOKED: 'token.revoked',
  RUN_INGESTED: 'run.ingested',
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_REJECTED: 'webhook.rejected',
  RETENTION_SWEPT: 'retention.swept',
  ALERT_RULE_CREATED: 'alert-rule.created',
  ALERT_RULE_TOGGLED: 'alert-rule.toggled',
  ALERT_RULE_DELETED: 'alert-rule.deleted',
} as const;

export type AuditKind = (typeof AUDIT_KINDS)[keyof typeof AUDIT_KINDS];

export interface ListAuditParams {
  /** Filter by kind. Multiple kinds OR'd together. */
  kinds?: readonly string[];
  /** Filter by user. */
  userId?: string;
  /** Limit. Default 50, max 500. */
  limit?: number;
  /** Cursor: occurredAt ISO string. Returns events strictly older than this. */
  beforeOccurredAt?: Date;
}

export async function listAuditEvents(
  db: Db,
  params: ListAuditParams = {},
): Promise<AuditEvent[]> {
  const limit = Math.min(Math.max(1, params.limit ?? 50), 500);
  const where = and(
    params.userId ? eq(auditEvents.userId, params.userId) : undefined,
    params.beforeOccurredAt
      ? lt(auditEvents.occurredAt, params.beforeOccurredAt)
      : undefined,
  );
  const rows = await db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.occurredAt))
    .limit(limit);

  // `kind IN (...)` is filtered in JS to keep the query simple — the
  // most common filter is "no filter at all" and the limit caps the
  // result set well under any practical N.
  if (params.kinds && params.kinds.length > 0) {
    const kindSet = new Set(params.kinds);
    return rows.filter((r) => kindSet.has(r.kind));
  }
  return rows;
}

/** Human-readable label for an audit-kind, used by the admin UI. */
export function auditKindLabel(kind: string): string {
  switch (kind) {
    case AUDIT_KINDS.USER_SIGNED_IN:
      return 'Signed in';
    case AUDIT_KINDS.USER_SIGNED_OUT:
      return 'Signed out';
    case AUDIT_KINDS.AUTH_FAILED:
      return 'Auth failed';
    case AUDIT_KINDS.TOKEN_MINTED:
      return 'Token minted';
    case AUDIT_KINDS.TOKEN_REVOKED:
      return 'Token revoked';
    case AUDIT_KINDS.RUN_INGESTED:
      return 'Run ingested';
    case AUDIT_KINDS.WEBHOOK_RECEIVED:
      return 'Webhook received';
    case AUDIT_KINDS.WEBHOOK_REJECTED:
      return 'Webhook rejected';
    case AUDIT_KINDS.RETENTION_SWEPT:
      return 'Retention swept';
    case AUDIT_KINDS.ALERT_RULE_CREATED:
      return 'Alert rule created';
    case AUDIT_KINDS.ALERT_RULE_TOGGLED:
      return 'Alert rule toggled';
    case AUDIT_KINDS.ALERT_RULE_DELETED:
      return 'Alert rule deleted';
    default:
      return kind;
  }
}
