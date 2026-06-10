/**
 * Google OAuth helpers (Web Application Flow / OpenID Connect).
 *
 * https://developers.google.com/identity/protocols/oauth2/web-server
 *
 * Mirrors the GitHub flow in `oauth.ts`: same state-mint/verify
 * (re-exported from there for caller convenience), same redirect-
 * cookie pattern, same no-JIT-user-creation policy at the callback.
 * The only differences are wire-level:
 *
 * - Authorize URL: `accounts.google.com/o/oauth2/v2/auth`
 * - Token URL:     `oauth2.googleapis.com/token`
 * - Profile URL:   `openidconnect.googleapis.com/v1/userinfo`
 *
 * Scopes: `openid email profile`. The `userinfo` endpoint returns
 * `email` + `email_verified`; we **reject unverified emails** so a
 * Google account that hasn't completed email verification can't
 * sign in even when its address matches a local user.
 */

// State helpers are provider-agnostic — re-export from the GitHub
// file so callers can `import { mintOAuthState, verifyOAuthState,
// OAUTH_STATE_COOKIE } from '@/lib/google-oauth'` without caring
// which provider is wired today.
export {
  mintOAuthState,
  verifyOAuthState,
  OAUTH_STATE_COOKIE,
  type MintedState,
  type VerifyStateResult,
} from './oauth';

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL =
  'https://openidconnect.googleapis.com/v1/userinfo';

// ─── authorize URL ──────────────────────────────────────────────────────

export interface BuildGoogleAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Override the requested scopes. Defaults to `openid email profile`. */
  scope?: string;
}

export function buildGoogleAuthorizeUrl(
  input: BuildGoogleAuthorizeUrlInput,
): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.scope ?? 'openid email profile');
  // No `prompt=consent` — repeat sign-ins skip the consent screen.
  // `access_type=online` is the default; we don't need refresh tokens.
  return url.toString();
}

// ─── code exchange ──────────────────────────────────────────────────────

export interface ExchangeGoogleCodeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

export interface GoogleAccessToken {
  accessToken: string;
  /** Seconds until expiry, as reported by Google. We don't store this. */
  expiresIn: number;
  scope: string;
  tokenType: string;
}

export async function exchangeGoogleCodeForToken(
  input: ExchangeGoogleCodeInput,
): Promise<GoogleAccessToken> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth: token exchange failed ${res.status}`);
  }
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (body.error) {
    throw new Error(
      `Google OAuth: ${body.error}${body.error_description ? ` — ${body.error_description}` : ''}`,
    );
  }
  if (!body.access_token) {
    throw new Error('Google OAuth: token exchange returned no access_token');
  }
  return {
    accessToken: body.access_token,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 0,
    scope: body.scope ?? '',
    tokenType: body.token_type ?? 'Bearer',
  };
}

// ─── user profile ───────────────────────────────────────────────────────

export interface GoogleUser {
  /** Stable Google user id (`sub` claim). */
  id: string;
  /** Verified primary email. Throws when Google reports `email_verified: false`. */
  email: string;
  /** Display name (may be null when the user hasn't set one). */
  name: string | null;
}

export async function fetchGoogleUser(
  accessToken: string,
  customFetch?: typeof fetch,
): Promise<GoogleUser> {
  const fetchImpl = customFetch ?? globalThis.fetch;
  const res = await fetchImpl(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google OAuth: /userinfo fetch failed ${res.status}`);
  }
  const body = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string | null;
  };
  if (typeof body.sub !== 'string') {
    throw new Error('Google OAuth: /userinfo returned no `sub`');
  }
  if (typeof body.email !== 'string') {
    throw new Error('Google OAuth: /userinfo returned no email');
  }
  // Hard-reject unverified emails. A Google account whose owner hasn't
  // proven control of the address must not be able to claim a local
  // user with that same address.
  if (body.email_verified !== true) {
    throw new Error(
      'Google OAuth: account email is not verified — drift-ci requires a verified email to sign in.',
    );
  }
  return {
    id: body.sub,
    email: body.email,
    name: typeof body.name === 'string' ? body.name : null,
  };
}
