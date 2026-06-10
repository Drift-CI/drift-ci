import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * GitHub OAuth helpers (Web Application Flow).
 *
 * https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
 *
 * The plain "OAuth App" flow is enough for our needs (sign-in only).
 * GitHub App installations land later if/when we want fine-grained
 * repo permissions for webhook setup.
 *
 * State CSRF protection: we mint an HMAC-signed `<random>.<hmac>`
 * value, set it as a short-lived cookie, and require the same value
 * back in the callback URL. The signature uses the same
 * DRIFT_SESSION_SECRET as the session cookie, so the same key
 * rotation invalidates pending OAuth flows too.
 */

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const GITHUB_USER_EMAILS_URL = 'https://api.github.com/user/emails';

export const OAUTH_STATE_COOKIE = 'drift_oauth_state';
const STATE_TTL_SECONDS = 600;

// ─── state mint/verify ──────────────────────────────────────────────────

export interface MintedState {
  raw: string;
  cookieValue: string;
}

export function mintOAuthState(secret: string, now: Date = new Date()): MintedState {
  if (!secret) throw new Error('mintOAuthState: secret is required');
  const nonce = randomBytes(16).toString('base64url');
  const issuedAt = Math.floor(now.getTime() / 1000);
  const body = `${nonce}.${issuedAt}`;
  const sig = hmac(body, secret);
  const value = `${body}.${sig}`;
  return { raw: value, cookieValue: value };
}

export interface VerifyStateResult {
  ok: boolean;
  reason?: 'mismatch' | 'malformed' | 'bad-signature' | 'expired';
}

export function verifyOAuthState(
  cookieValue: string | null | undefined,
  callbackValue: string | null | undefined,
  secret: string,
  now: Date = new Date(),
): VerifyStateResult {
  if (!cookieValue || !callbackValue) return { ok: false, reason: 'malformed' };
  if (cookieValue !== callbackValue) return { ok: false, reason: 'mismatch' };
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [nonce, issuedAtStr, sig] = parts;
  const expectedSig = hmac(`${nonce}.${issuedAtStr}`, secret);
  if (!constantHexEquals(sig, expectedSig)) {
    return { ok: false, reason: 'bad-signature' };
  }
  const issuedAt = Number.parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'malformed' };
  const ageSec = Math.floor(now.getTime() / 1000) - issuedAt;
  if (ageSec > STATE_TTL_SECONDS) return { ok: false, reason: 'expired' };
  return { ok: true };
}

// ─── authorize URL ──────────────────────────────────────────────────────

export interface BuildAuthorizeUrlInput {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}

export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', input.scope ?? 'read:user user:email');
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

// ─── code exchange ──────────────────────────────────────────────────────

export interface ExchangeCodeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  fetch?: typeof fetch;
}

export interface AccessToken {
  accessToken: string;
  scope: string;
  tokenType: string;
}

export async function exchangeCodeForToken(
  input: ExchangeCodeInput,
): Promise<AccessToken> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const res = await fetchImpl(GITHUB_TOKEN_URL, {
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
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`OAuth: token exchange failed ${res.status}`);
  }
  const body = (await res.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (body.error) {
    throw new Error(`OAuth: ${body.error}${body.error_description ? ` — ${body.error_description}` : ''}`);
  }
  if (!body.access_token) {
    throw new Error('OAuth: token exchange returned no access_token');
  }
  return {
    accessToken: body.access_token,
    scope: body.scope ?? '',
    tokenType: body.token_type ?? 'bearer',
  };
}

// ─── user profile ───────────────────────────────────────────────────────

export interface GitHubUser {
  /** Numeric GitHub user id. */
  id: number;
  /** Login (handle). */
  login: string;
  /** Primary verified email. May come from /user or /user/emails. */
  email: string;
  /** Display name. */
  name: string | null;
}

export async function fetchGitHubUser(
  accessToken: string,
  customFetch?: typeof fetch,
): Promise<GitHubUser> {
  const fetchImpl = customFetch ?? globalThis.fetch;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'drift-ci/dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const profileRes = await fetchImpl(GITHUB_USER_URL, { headers });
  if (!profileRes.ok) {
    throw new Error(`OAuth: /user fetch failed ${profileRes.status}`);
  }
  const profile = (await profileRes.json()) as {
    id?: number;
    login?: string;
    email?: string | null;
    name?: string | null;
  };
  if (typeof profile.id !== 'number' || typeof profile.login !== 'string') {
    throw new Error('OAuth: /user returned an unexpected shape');
  }

  let email = profile.email ?? null;
  if (!email) {
    // /user can return null email when the user marks it private. The
    // /user/emails endpoint requires the `user:email` scope which we
    // request — fall through to the primary verified address.
    const emailsRes = await fetchImpl(GITHUB_USER_EMAILS_URL, { headers });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{
        email: string;
        primary?: boolean;
        verified?: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified);
      email = primary?.email ?? null;
    }
  }
  if (!email) {
    throw new Error(
      'OAuth: GitHub returned no verified primary email — drift-ci needs one to match a user account.',
    );
  }

  return {
    id: profile.id,
    login: profile.login,
    email,
    name: profile.name ?? null,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────

function hmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function constantHexEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
