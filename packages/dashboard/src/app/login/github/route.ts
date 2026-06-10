import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  buildAuthorizeUrl,
  mintOAuthState,
  OAUTH_STATE_COOKIE,
} from '@/lib/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /login/github?next=…
 *
 * Initiates the OAuth Web Application Flow:
 *   1. Mint an HMAC-signed state value.
 *   2. Stash it in an HttpOnly + SameSite=Lax cookie alongside the
 *      caller's `next` target so the callback can resume the redirect.
 *   3. 302 to GitHub's authorize endpoint.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const sessionSecret = process.env.DRIFT_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) {
    return NextResponse.redirect(new URL('/login?error=oauth-not-configured', request.url));
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

  const authorize = buildAuthorizeUrl({
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
  const explicit = process.env.DRIFT_OAUTH_REDIRECT_URI;
  if (explicit) return explicit;
  const url = new URL(request.url);
  return `${url.origin}/login/github/callback`;
}
