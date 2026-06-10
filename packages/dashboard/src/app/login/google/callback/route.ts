import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { AUDIT_KINDS, recordAudit } from '@/lib/audit';
import { getDb } from '@/lib/db';
import {
  exchangeGoogleCodeForToken,
  fetchGoogleUser,
  OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from '@/lib/google-oauth';
import { users } from '@/lib/schema';
import {
  buildSessionCookie,
  signSession,
  type SessionPayload,
} from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /login/google/callback?code=…&state=…
 *
 * Mirrors the GitHub callback:
 *   1. Verify HMAC-signed state cookie matches the callback param.
 *   2. Exchange the code for an access token.
 *   3. Fetch the Google profile from `/userinfo` (rejects unverified
 *      emails inside `fetchGoogleUser`).
 *   4. Match the verified email against the local `users` table —
 *      **no JIT user creation**. A hostile Google account whose
 *      verified email isn't already in the DB cannot sign in.
 *   5. Mint the same `drift_session` cookie the password / GitHub
 *      flows produce.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
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
    token = await exchangeGoogleCodeForToken({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });
  } catch {
    /* c8 ignore next */
    return redirectToLogin(request, 'oauth-token-exchange');
  }

  let googleUser;
  try {
    googleUser = await fetchGoogleUser(token.accessToken);
  } catch {
    /* c8 ignore next */
    return redirectToLogin(request, 'oauth-user-fetch');
  }

  const db = getDb();
  const rows = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, googleUser.email))
    .limit(1);
  if (rows.length === 0) {
    await recordAudit(db, {
      kind: AUDIT_KINDS.AUTH_FAILED,
      data: {
        via: 'google-oauth',
        reason: 'no-matching-user',
        googleSub: googleUser.id,
      },
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
    data: { via: 'google-oauth', googleSub: googleUser.id },
  });

  const next = decodeNext(encodedNextCookie);
  return NextResponse.redirect(new URL(next, request.url));
}

function redirectToLogin(request: Request, reason: string): NextResponse {
  return NextResponse.redirect(new URL(`/login?error=${reason}`, request.url));
}

function redirectUriFor(request: Request): string {
  const explicit = process.env.DRIFT_GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/login/google/callback`;
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
