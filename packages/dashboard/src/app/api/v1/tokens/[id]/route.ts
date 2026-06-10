import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { checkOrigin } from '@/lib/origin';
import { requireAuth } from '@/lib/route-auth';
import { apiTokens } from '@/lib/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/v1/tokens/[id]
 *
 * Soft-revokes the token by setting `revoked_at = now()`. Already-
 * revoked tokens return 200 idempotently. Requires `tokens:manage`.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const origin = checkOrigin(request);
  if (!origin.ok) {
    return NextResponse.json(
      { ok: false, error: `origin: ${origin.reason}` },
      { status: 403 },
    );
  }

  const auth = await requireAuth(request, { requiredScope: 'tokens:manage' });
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const db = getDb();

  // Don't let a token revoke itself in the middle of the same request —
  // the `last_used_at` write fired before we got here, so it's not a
  // hard race, but still surface a clear error so users don't lock
  // themselves out by accident.
  if (id === auth.tokenId) {
    return NextResponse.json(
      { ok: false, error: 'a token cannot revoke itself' },
      { status: 409 },
    );
  }

  const result = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, id), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });

  if (result.length > 0) {
    await recordAudit(db, {
      userId: auth.userId === 'bootstrap' ? null : auth.userId,
      tokenId: auth.tokenId === 'bootstrap' ? null : auth.tokenId,
      kind: AUDIT_KINDS.TOKEN_REVOKED,
      target: id,
    });
  }

  // If nothing was updated, the token either doesn't exist or was
  // already revoked. Treat both as success — DELETE is idempotent.
  return NextResponse.json(
    { ok: true, revoked: result.length > 0 },
    { status: 200 },
  );
}
