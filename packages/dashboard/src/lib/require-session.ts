import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { getDb } from './db';
import { users } from './schema';
import { SESSION_COOKIE_NAME, verifySession, type SessionPayload } from './session';

/**
 * SSR helper: returns the session payload, or `redirect()`s the user
 * to `/login?next=<targetPath>` when the cookie is missing/expired/
 * tampered. Use it at the top of every SSR page that should be
 * gated behind a sign-in.
 *
 * Pages can additionally pass `{ role: 'admin' }` to gate themselves
 * behind a role; the redirect target then changes to `/` (so members
 * trying to reach an admin page land back on the dashboard rather
 * than getting bounced through /login indefinitely).
 */
export interface RequireSessionOptions {
  targetPath: string;
  role?: SessionPayload['role'];
}

export async function requireSession(
  opts: RequireSessionOptions,
): Promise<SessionPayload> {
  const secret = process.env.DRIFT_SESSION_SECRET;
  if (!secret) {
    // Closed-by-default: an unconfigured deploy can't sign sessions,
    // so it can't authenticate anyone. Surface a clear redirect to
    // /login (which renders a banner explaining the missing env).
    redirect(`/login?next=${encodeURIComponent(opts.targetPath)}`);
  }
  const jar = await cookies();
  const cookie = jar.get(SESSION_COOKIE_NAME)?.value;
  const verified = verifySession(cookie, secret);
  if (!verified.ok || !verified.payload) {
    redirect(`/login?next=${encodeURIComponent(opts.targetPath)}`);
  }
  if (opts.role && verified.payload.role !== opts.role) {
    // Don't reveal whether the page exists at all for non-admins.
    redirect('/');
  }
  // Best-effort presence check so deleted users get bounced too.
  if (verified.payload.userId !== 'bootstrap') {
    const db = getDb();
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, verified.payload.userId))
      .limit(1);
    if (rows.length === 0) {
      redirect(`/login?next=${encodeURIComponent(opts.targetPath)}`);
    }
  }
  return verified.payload;
}
