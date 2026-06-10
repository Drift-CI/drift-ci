'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { users } from '@/lib/schema';
import {
  buildClearCookie,
  buildSessionCookie,
  SESSION_COOKIE_NAME,
  signSession,
  verifySession,
  type SessionPayload,
} from '@/lib/session';
import { constantTimeEquals } from '@/lib/tokens';

/**
 * Single-tenant password sign-in. Validates against
 * `DRIFT_DASHBOARD_PASSWORD` (constant-time compare), then hands
 * out a signed session cookie tied to the first admin user. M21b
 * replaces this with a GitHub OAuth handshake; the cookie format
 * itself doesn't change.
 *
 * Rate-limited at 10/min per IP to slow brute-force on the password.
 * Every attempt — success or failure — writes an audit row.
 */
export async function signInAction(formData: FormData): Promise<void> {
  const password = (formData.get('password') as string | null) ?? '';
  const next = (formData.get('next') as string | null) || '/';
  const expected = process.env.DRIFT_DASHBOARD_PASSWORD;
  const secret = process.env.DRIFT_SESSION_SECRET;
  const ip = await readClientIp();

  const limited = await rateLimit({
    key: `login:${ip}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!limited.allowed) {
    await recordAudit(getDb(), {
      kind: AUDIT_KINDS.AUTH_FAILED,
      data: { reason: 'rate-limited', ip },
    });
    redirect('/login?error=rate-limited');
  }

  if (!expected || !secret) {
    redirect('/login?error=not-configured');
  }
  if (!password || !constantTimeEquals(password, expected)) {
    await recordAudit(getDb(), {
      kind: AUDIT_KINDS.AUTH_FAILED,
      data: { reason: 'bad-password', ip },
    });
    redirect(
      `/login?error=bad-password&next=${encodeURIComponent(safeNext(next))}`,
    );
  }

  // Resolve the admin user we'll associate this session with. If no
  // admin exists yet (e.g. DRIFT_ADMIN_EMAIL was never set), refuse
  // sign-in with a clear message — the session can't be tied to
  // anyone.
  const db = getDb();
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1);
  if (rows.length === 0) {
    await recordAudit(db, {
      kind: AUDIT_KINDS.AUTH_FAILED,
      data: { reason: 'no-admin', ip },
    });
    redirect('/login?error=no-admin');
  }
  const admin = rows[0];

  const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
    userId: admin.id,
    email: admin.email,
    role: admin.role,
  };
  const value = signSession(payload, secret);
  const cookie = buildSessionCookie(value);

  const jar = await cookies();
  jar.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });

  await recordAudit(db, {
    userId: admin.id,
    kind: AUDIT_KINDS.USER_SIGNED_IN,
    data: { ip },
  });

  redirect(safeNext(next));
}

export async function signOutAction(): Promise<void> {
  // Best-effort: read the session before we wipe it so we can
  // attribute the audit row to the right user.
  const secret = process.env.DRIFT_SESSION_SECRET;
  const jar = await cookies();
  const existing = jar.get(SESSION_COOKIE_NAME)?.value;
  let userId: string | undefined;
  if (existing && secret) {
    const verified = verifySession(existing, secret);
    if (verified.ok && verified.payload) userId = verified.payload.userId;
  }

  const cookie = buildClearCookie();
  jar.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });

  if (userId) {
    await recordAudit(getDb(), {
      userId,
      kind: AUDIT_KINDS.USER_SIGNED_OUT,
    });
  }

  redirect('/login');
}

async function readClientIp(): Promise<string | null> {
  /* c8 ignore start -- only fires inside a real Next.js request. */
  try {
    const h = await headers();
    return (
      h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      h.get('x-real-ip') ??
      null
    );
  } catch {
    return null;
  }
  /* c8 ignore stop */
}

/** Reject open-redirect targets — only allow same-origin paths. */
function safeNext(next: string): string {
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  return next;
}
