import { and, eq, isNull, or, gt } from 'drizzle-orm';

import type { Db } from './db';
import { apiTokens, users, type UserRole } from './schema';
import { parseAuthHeader, verifyTokenHash, constantTimeEquals } from './tokens';

// ─── result shape ────────────────────────────────────────────────────────

export type AuthFailReason =
  | 'no-auth-configured'
  | 'missing-header'
  | 'bad-scheme'
  | 'bad-token'
  | 'expired'
  | 'revoked'
  | 'insufficient-scope';

export type AuthOk = {
  ok: true;
  userId: string;
  role: UserRole;
  tokenId: string;
  scopes: readonly string[];
  /** True when authenticated via the bootstrap DRIFT_INGEST_TOKEN env var. */
  bootstrap?: boolean;
};

export type AuthFail = {
  ok: false;
  reason: AuthFailReason;
};

export type AuthResult = AuthOk | AuthFail;

// ─── role → default scopes ───────────────────────────────────────────────
//
// A token's effective scopes are the intersection of its declared scopes
// and the role's default scopes. This means revoking a role downgrades
// all of that user's tokens immediately, without rotating each one.

const ROLE_SCOPES: Record<UserRole, readonly string[]> = {
  admin: ['runs:read', 'runs:write', 'tokens:manage', 'audit:read', 'alerts:manage'],
  member: ['runs:read', 'runs:write', 'alerts:manage'],
  viewer: ['runs:read'],
};

function effectiveScopes(role: UserRole, declared: readonly string[]): string[] {
  const allowed = new Set(ROLE_SCOPES[role]);
  return declared.filter((s) => allowed.has(s));
}

export function hasScope(scopes: readonly string[], required: string | undefined): boolean {
  if (!required) return true;
  return scopes.includes(required);
}

// ─── DB-backed validation ───────────────────────────────────────────────

export interface ValidateApiTokenOptions {
  /** Required scope, e.g. 'runs:read' or 'runs:write'. Omit for any-scope. */
  requiredScope?: string;
  /**
   * Bootstrap fallback: if the DB has zero users yet AND
   * `DRIFT_INGEST_TOKEN` matches the bearer, return a synthetic admin
   * principal. Closes the chicken-and-egg gap before the first admin
   * is seeded. Disabled the moment any user exists.
   */
  bootstrapToken?: string;
  /** Override `now` for tests. */
  now?: Date;
  /** When false, skip the lastUsedAt write (tests / read-only contexts). */
  touchLastUsed?: boolean;
}

/**
 * Validate the `Authorization` header against the api_tokens table.
 * Resolves the user + role and returns the effective scope set, or a
 * structured failure reason otherwise. Never throws — callers map the
 * reason to an HTTP status.
 */
export async function validateApiToken(
  headerValue: string | null,
  db: Db,
  opts: ValidateApiTokenOptions = {},
): Promise<AuthResult> {
  const now = opts.now ?? new Date();
  const parsed = parseAuthHeader(headerValue);

  // Bootstrap path: if no users exist yet AND the bootstrap env var is
  // configured AND the raw header matches, accept as a synthetic admin.
  // We branch on missing-header AFTER bootstrap because the bootstrap
  // check needs the raw value (it isn't a "drift_..." token).
  if (opts.bootstrapToken) {
    const noUsers = await isUsersEmpty(db);
    if (noUsers) {
      const headerToken = stripBearer(headerValue);
      if (!headerToken) {
        return {
          ok: false,
          reason: headerValue ? 'bad-scheme' : 'missing-header',
        };
      }
      if (constantTimeEquals(headerToken, opts.bootstrapToken)) {
        return {
          ok: true,
          userId: 'bootstrap',
          role: 'admin',
          tokenId: 'bootstrap',
          scopes: ROLE_SCOPES.admin,
          bootstrap: true,
        };
      }
      return { ok: false, reason: 'bad-token' };
    }
  }

  if (!parsed) {
    if (!headerValue) return { ok: false, reason: 'missing-header' };
    // Header is present but not a Bearer-with-drift_-token.
    return {
      ok: false,
      reason: headerValue.toLowerCase().startsWith('bearer ')
        ? 'bad-token'
        : 'bad-scheme',
    };
  }

  const rows = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      role: users.role,
      hash: apiTokens.hash,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.prefix, parsed.prefix),
        isNull(apiTokens.revokedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    // Either the prefix doesn't exist OR the row is revoked/expired.
    // Don't leak which — return the same code we'd use for a bad
    // secret so attackers can't enumerate.
    return { ok: false, reason: 'bad-token' };
  }

  const matches = await verifyTokenHash(parsed, row.hash);
  if (!matches) return { ok: false, reason: 'bad-token' };

  const scopes = effectiveScopes(row.role, row.scopes);
  if (!hasScope(scopes, opts.requiredScope)) {
    return { ok: false, reason: 'insufficient-scope' };
  }

  if (opts.touchLastUsed !== false) {
    // Best-effort — don't block the request on the write.
    db.update(apiTokens)
      .set({ lastUsedAt: now })
      .where(eq(apiTokens.id, row.id))
      .catch(() => undefined);
  }

  return {
    ok: true,
    userId: row.userId,
    role: row.role,
    tokenId: row.id,
    scopes,
  };
}

async function isUsersEmpty(db: Db): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).limit(1);
  return rows.length === 0;
}

function stripBearer(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const [scheme, value] = headerValue.split(/\s+/, 2);
  if ((scheme ?? '').toLowerCase() !== 'bearer') return null;
  return value ?? null;
}

// ─── back-compat shim ───────────────────────────────────────────────────
//
// Preserves the M18 entry point so existing callers don't break while we
// migrate. Routes flip to validateApiToken in the same M20a commit.

export interface IngestAuthResult {
  ok: boolean;
  reason?: 'no-token-configured' | 'missing-header' | 'bad-scheme' | 'bad-token';
}

export function validateIngestAuth(
  headerValue: string | null,
  expectedToken: string | undefined,
): IngestAuthResult {
  if (!expectedToken) return { ok: false, reason: 'no-token-configured' };
  if (!headerValue) return { ok: false, reason: 'missing-header' };
  const [scheme, value] = headerValue.split(/\s+/, 2);
  if ((scheme ?? '').toLowerCase() !== 'bearer') {
    return { ok: false, reason: 'bad-scheme' };
  }
  if (!value) return { ok: false, reason: 'bad-token' };
  return constantTimeEquals(value, expectedToken)
    ? { ok: true }
    : { ok: false, reason: 'bad-token' };
}

export { ROLE_SCOPES };
