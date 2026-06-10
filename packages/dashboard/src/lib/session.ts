import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed-cookie session for the SSR dashboard pages.
 *
 * The API routes use Bearer tokens (see lib/auth.ts). The SSR pages
 * use this cookie instead so users don't have to paste an API token
 * into every browser tab.
 *
 * Cookie format:
 *   `<base64url(payload-json)>.<hex(hmac-sha256(payload-json))>`
 *
 * The HMAC key is the `DRIFT_SESSION_SECRET` env var. Rotating it
 * invalidates every existing session — desired for incident response.
 *
 * This is intentionally *small* — no Iron Session, no JWT lib. M21
 * layers GitHub OAuth on top by replacing the password check with
 * an OAuth handshake; the cookie format itself stays the same.
 */

export const SESSION_COOKIE_NAME = 'drift_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  /** UUID of the dashboard user. `'bootstrap'` only when no users exist yet. */
  userId: string;
  /** Display label for the page chrome. */
  email: string;
  /** Pre-resolved role — saves a DB hit on every page render. */
  role: 'admin' | 'member' | 'viewer';
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expires-at, seconds since epoch. */
  exp: number;
}

export interface SignOptions {
  ttlSeconds?: number;
  now?: Date;
}

export function signSession(
  payload: Omit<SessionPayload, 'iat' | 'exp'>,
  secret: string,
  opts: SignOptions = {},
): string {
  if (!secret) throw new Error('signSession: secret is required');
  const now = opts.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const full: SessionPayload = { ...payload, iat, exp };
  const body = base64url(JSON.stringify(full));
  return `${body}.${hmac(body, secret)}`;
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'missing' | 'malformed' | 'bad-signature' | 'expired';
  payload?: SessionPayload;
}

export function verifySession(
  cookieValue: string | null | undefined,
  secret: string,
  opts: { now?: Date } = {},
): VerifyResult {
  if (!cookieValue) return { ok: false, reason: 'missing' };
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  const expected = hmac(body, secret);
  if (!constantHexEquals(sig, expected)) {
    return { ok: false, reason: 'bad-signature' };
  }
  let parsed: SessionPayload;
  try {
    parsed = JSON.parse(decodeBase64url(body)) as SessionPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof parsed.userId !== 'string' ||
    typeof parsed.email !== 'string' ||
    typeof parsed.role !== 'string' ||
    typeof parsed.iat !== 'number' ||
    typeof parsed.exp !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (parsed.exp <= nowSec) return { ok: false, reason: 'expired' };
  return { ok: true, payload: parsed };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function hmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

function base64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}

function decodeBase64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function constantHexEquals(a: string, b: string): boolean {
  // Hex strings of the same length compare via timingSafeEqual.
  if (a.length !== b.length) return false;
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Cookie attributes used when setting / clearing the session. */
export interface SessionCookieAttributes {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

export function buildSessionCookie(
  value: string,
  opts: { ttlSeconds?: number; secure?: boolean } = {},
): SessionCookieAttributes {
  return {
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: 'lax',
    secure: opts.secure ?? process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: opts.ttlSeconds ?? DEFAULT_TTL_SECONDS,
  };
}

export function buildClearCookie(opts: { secure?: boolean } = {}): SessionCookieAttributes {
  return buildSessionCookie('', { ttlSeconds: 0, secure: opts.secure });
}
