import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import {
  exchangeCodeForToken,
  fetchGitHubUser,
  OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from '@/lib/oauth';
import { users } from '@/lib/schema';
import {
  buildSessionCookie,
  signSession,
  type SessionPayload,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /login/github/callback?code=…&state=…
 *
 * Verifies the state cookie, exchanges the code for a token, fetches
 * the GitHub user, matches the verified email against the local
 * `users` table, then mints a session cookie.
 *
 * No JIT user creation: an admin must have been seeded (via
 * DRIFT_ADMIN_EMAIL) or invited by an existing admin (M21c). This
 * keeps the trust boundary tight — a hostile GitHub account can
 * sign in only when its primary email already exists in the DB.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const sessionSecret = process.env.DRIFT_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) {
    return redirectToLogin(request, 'oauth-not-configured');
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return redirectToLogin(request, 'oauth-malformed-callback');
  }

  const jar = await cookies();
  const cookieState = jar.get(OAUTH_STATE_COOKIE)?.value ?? null;

  // Strip the `|<next>` suffix we appended in /login/github before
  // verifying the HMAC. The signed body matches what mintOAuthState
  // produced; the suffix is just a UX carrier.
  const [signedCookie, encodedNextCookie] = (cookieState ?? '').split('|', 2);
  const [signedCallback] = state.split('|', 2);

  const verified = verifyOAuthState(signedCookie, signedCallback, sessionSecret);
  if (!verified.ok) {
    jar.delete(OAUTH_STATE_COOKIE);
    return redirectToLogin(request, `oauth-state-${verified.reason}`);
  }
  jar.delete(OAUTH_STATE_COOKIE);

  const redirectUri = redirectUriFor(request);

  let token;
  try {
    token = await exchangeCodeForToken({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });
  } catch {
    /* c8 ignore next */
    return redirectToLogin(request, 'oauth-token-exchange');
  }

  let ghUser;
  try {
    ghUser = await fetchGitHubUser(token.accessToken);
  } catch {
    /* c8 ignore next */
    return redirectToLogin(request, 'oauth-user-fetch');
  }

  // Match the verified email to a local user. We do NOT auto-create —
  // see route doc comment.
  const db = getDb();
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, ghUser.email))
    .limit(1);
  if (rows.length === 0) {
    await recordAudit(db, {
      kind: AUDIT_KINDS.AUTH_FAILED,
      data: { via: 'github-oauth', reason: 'no-matching-user', githubLogin: ghUser.login },
    });
    return redirectToLogin(request, 'oauth-no-matching-user');
  }
  const local = rows[0];

  const payload: Omit<SessionPayload, 'iat' | 'exp'> = {
    userId: local.id,
    email: local.email,
    role: local.role,
  };
  const value = signSession(payload, sessionSecret);
  const cookie = buildSessionCookie(value);
  jar.set(cookie.name, cookie.value, {
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    secure: cookie.secure,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });

  await recordAudit(db, {
    userId: local.id,
    kind: AUDIT_KINDS.USER_SIGNED_IN,
    data: { via: 'github-oauth', githubLogin: ghUser.login },
  });

  const next = decodeNext(encodedNextCookie);
  return NextResponse.redirect(new URL(next, request.url));
}

function redirectToLogin(request: Request, reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
}

function redirectUriFor(request: Request): string {
  const explicit = process.env.DRIFT_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/login/github/callback`;
}

function decodeNext(encoded: string | undefined): string {
  if (!encoded) return '/';
  try {
    const decoded = decodeURIComponent(encoded);
    if (!decoded.startsWith('/') || decoded.startsWith('//')) return '/';
    return decoded;
    /* c8 ignore next 3 */
  } catch {
    return '/';
  }
}
