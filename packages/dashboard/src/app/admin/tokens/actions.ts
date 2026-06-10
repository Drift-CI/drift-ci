'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { requireSession } from '@/lib/require-session';
import { apiTokens, users } from '@/lib/schema';
import { mintToken } from '@/lib/tokens';

const ALLOWED_SCOPES = ['runs:read', 'runs:write', 'tokens:manage', 'audit:read'] as const;

export interface MintFormResult {
  status: 'minted';
  tokenId: string;
  plaintext: string;
}

/**
 * Server action: mint a new token from the form on `/admin/tokens`.
 * The plaintext is shoved into a one-shot `?minted=<id>` URL query so
 * the redirected page can show it once before the user reloads.
 */
export async function mintTokenAction(formData: FormData): Promise<void> {
  const session = await requireSession({
    targetPath: '/admin/tokens',
    role: 'admin',
  });

  if (session.userId === 'bootstrap') {
    redirect('/admin/tokens?error=bootstrap-no-mint');
  }

  const name = (formData.get('name') as string | null)?.trim() ?? '';
  if (!name || name.length > 80) redirect('/admin/tokens?error=bad-name');

  const scopesRaw = formData.getAll('scopes');
  const scopes = scopesRaw
    .filter((s): s is string => typeof s === 'string')
    .filter((s): s is (typeof ALLOWED_SCOPES)[number] =>
      (ALLOWED_SCOPES as readonly string[]).includes(s),
    );
  if (scopes.length === 0) redirect('/admin/tokens?error=no-scopes');

  const expiresRaw = (formData.get('expiresAt') as string | null) || null;
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    redirect('/admin/tokens?error=bad-expiry');
  }

  const db = getDb();
  const callerRows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  /* c8 ignore next 3 -- defensive: requireSession already verified the row. */
  if (callerRows.length === 0) {
    redirect('/login?next=%2Fadmin%2Ftokens');
  }

  const minted = await mintToken();
  const tokenId = randomUUID();
  await db.insert(apiTokens).values({
    id: tokenId,
    userId: session.userId,
    name,
    prefix: minted.prefix,
    hash: minted.hash,
    scopes,
    expiresAt,
  });

  await recordAudit(db, {
    userId: session.userId,
    tokenId,
    kind: AUDIT_KINDS.TOKEN_MINTED,
    target: tokenId,
    data: { name, scopes, hasExpiry: expiresAt != null, via: 'admin-ui' },
  });

  // Stuff the plaintext into the URL hash so it's shown once after the
  // redirect. We can't use a server-side flash without adding a
  // session-store; the URL fragment is a pragmatic stand-in. M21
  // replaces this with a proper toast on a client component.
  const params = new URLSearchParams({ minted: minted.plaintext, name });
  revalidatePath('/admin/tokens');
  redirect(`/admin/tokens?${params.toString()}`);
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  const session = await requireSession({
    targetPath: '/admin/tokens',
    role: 'admin',
  });
  const id = (formData.get('id') as string | null) ?? '';
  if (!id) redirect('/admin/tokens?error=bad-id');

  const db = getDb();
  const result = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.id, id))
    .returning({ id: apiTokens.id });

  if (result.length > 0) {
    await recordAudit(db, {
      userId: session.userId,
      kind: AUDIT_KINDS.TOKEN_REVOKED,
      target: id,
      data: { via: 'admin-ui' },
    });
  }

  revalidatePath('/admin/tokens');
  redirect('/admin/tokens?revoked=1');
}
