import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  buildGoogleAuthorizeUrl,
  mintOAuthState,
  OAUTH_STATE_COOKIE,
} from '@/lib/google-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /login/google?next=…
 *
 * Mirrors `/login/github`: mints HMAC-signed state, stashes it
 * (with the `next` URL) in a 10-minute cookie, then 302s to
 * Google's authorize endpoint. The shared `OAUTH_STATE_COOKIE` is
 * fine because the GitHub and Google flows are mutually exclusive
 * within a browser session — only one can be in flight at a time.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const sessionSecret = process.env.DRIFT_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) {
    return NextResponse.redirect(
      new URL('/login?error=oauth-not-configured', request.url),
    );
  }

  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const redirectUri = redirectUriFor(request);

  const minted = mintOAuthState(sessionSecret);
  const state = `${minted.raw}|${encodeURIComponent(next)}`;

  const jar = await cookies();
  jar.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  const authorize = buildGoogleAuthorizeUrl({
    clientId,
    redirectUri,
    state,
  });
  return NextResponse.redirect(authorize);
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function redirectUriFor(request: Request): string {
  const explicit = process.env.DRIFT_GOOGLE_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/login/google/callback`;
}
