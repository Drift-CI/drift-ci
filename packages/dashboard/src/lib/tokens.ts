import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * API token model.
 *
 * On-the-wire shape:
 *   `drift_<prefix>_<secret>`
 *
 * - `prefix` is 8 alphanumeric chars and is stored verbatim, indexed.
 *   It lets us locate the right row in O(1) before paying the bcrypt
 *   compare cost.
 * - `secret` is 32 alphanumeric chars (~190 bits of entropy).
 * - The DB stores `bcrypt(prefix + ':' + secret)`. The plaintext token
 *   is shown to the user once at creation and never persisted.
 *
 * The `drift_` namespace prefix is for grep-ability — leaked tokens
 * are easy to spot in code-search and PR diffs. GitHub's secret-
 * scanning patterns can also be tuned to it.
 */

export interface MintedToken {
  /** The full plaintext token. Show once, never store. */
  plaintext: string;
  /** 8-char lookup key. Stored in DB. */
  prefix: string;
  /** bcrypt hash of `<prefix>:<secret>`. Stored in DB. */
  hash: string;
  /** UUID for the api_tokens.id column. */
  id: string;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const PREFIX_LEN = 8;
const SECRET_LEN = 32;
const BCRYPT_COST = 10;

export const TOKEN_PATTERN = /^drift_([A-Za-z0-9]{8})_([A-Za-z0-9]{32})$/;

function randomString(length: number): string {
  const buf = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

/** Mint a fresh token. Caller persists `{ id, prefix, hash }` and shows `plaintext` once. */
export async function mintToken(): Promise<MintedToken> {
  const prefix = randomString(PREFIX_LEN);
  const secret = randomString(SECRET_LEN);
  const plaintext = `drift_${prefix}_${secret}`;
  const hash = await bcrypt.hash(`${prefix}:${secret}`, BCRYPT_COST);
  return { plaintext, prefix, hash, id: randomUUID() };
}

export interface ParsedToken {
  prefix: string;
  secret: string;
}

/**
 * Strip the `Bearer ` scheme and validate shape. Returns null on any
 * deviation from the expected pattern — the caller treats null as
 * "auth header is malformed".
 */
export function parseAuthHeader(headerValue: string | null): ParsedToken | null {
  if (!headerValue) return null;
  const [scheme, value] = headerValue.split(/\s+/, 2);
  if ((scheme ?? '').toLowerCase() !== 'bearer') return null;
  return parseTokenString(value);
}

export function parseTokenString(token: string | undefined | null): ParsedToken | null {
  if (!token) return null;
  const match = TOKEN_PATTERN.exec(token);
  if (!match) return null;
  return { prefix: match[1], secret: match[2] };
}

/** Verify a parsed token against a stored bcrypt hash. */
export async function verifyTokenHash(
  parsed: ParsedToken,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(`${parsed.prefix}:${parsed.secret}`, hash);
}

/** Constant-time string compare for places that need it without bcrypt. */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
