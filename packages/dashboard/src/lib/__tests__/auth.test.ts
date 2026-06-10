import { describe, it, expect, vi } from 'vitest';

import { hasScope, ROLE_SCOPES, validateApiToken, validateIngestAuth } from '../auth';
import { mintToken } from '../tokens';
import type { Db } from '../db';
import type { UserRole } from '../schema';

// ─── DB fakes ────────────────────────────────────────────────────────────
//
// validateApiToken issues two selects:
//   1. SELECT id FROM users LIMIT 1            (only when bootstrapToken is set)
//   2. SELECT ... FROM api_tokens INNER JOIN users ... LIMIT 1
// plus an optional UPDATE api_tokens SET last_used_at=...
//
// We script those with a stateful fake so each test can craft the
// shape it needs.

interface UserStub {
  id: string;
}

interface TokenJoinRow {
  id: string;
  userId: string;
  role: UserRole;
  hash: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}

function makeAuthDb(opts: {
  users: UserStub[];
  tokenRow: TokenJoinRow | null;
}): { db: Db; updateCalled: { value: boolean } } {
  const updateCalled = { value: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersChain: any = {
    from: vi.fn(() => usersChain),
    limit: vi.fn(() => Promise.resolve(opts.users)),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokensChain: any = {
    from: vi.fn(() => tokensChain),
    innerJoin: vi.fn(() => tokensChain),
    where: vi.fn(() => tokensChain),
    limit: vi.fn(() => Promise.resolve(opts.tokenRow ? [opts.tokenRow] : [])),
  };
  let nextSelect: 'users' | 'tokens' = 'users';
  const select = vi.fn((cols?: Record<string, unknown>) => {
    // The users-empty check selects only `{ id: users.id }`. The token
    // join selects multiple columns. Routing on the column count keeps
    // each test's stub minimal.
    const isUsersOnly =
      cols !== undefined && Object.keys(cols).length === 1 && 'id' in cols;
    if (isUsersOnly && nextSelect === 'users') {
      nextSelect = 'tokens';
      return usersChain;
    }
    return tokensChain;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateChain: any = {
    set: vi.fn(() => updateChain),
    where: vi.fn(() => {
      updateCalled.value = true;
      return Promise.resolve();
    }),
    catch: vi.fn(),
  };
  const db = {
    select,
    update: vi.fn(() => updateChain),
  } as unknown as Db;
  return { db, updateCalled };
}

describe('hasScope', () => {
  it('returns true when no scope is required', () => {
    expect(hasScope([], undefined)).toBe(true);
  });

  it('returns true when the scope is present', () => {
    expect(hasScope(['runs:read'], 'runs:read')).toBe(true);
  });

  it('returns false when the scope is missing', () => {
    expect(hasScope(['runs:read'], 'runs:write')).toBe(false);
  });
});

describe('ROLE_SCOPES', () => {
  it('admin has the union of all scopes', () => {
    expect(ROLE_SCOPES.admin).toEqual(
      expect.arrayContaining([
        'runs:read',
        'runs:write',
        'tokens:manage',
        'audit:read',
        'alerts:manage',
      ]),
    );
  });

  it('viewer is read-only', () => {
    expect(ROLE_SCOPES.viewer).toEqual(['runs:read']);
  });

  it('member has runs:read, runs:write, and alerts:manage but not tokens:manage', () => {
    expect(ROLE_SCOPES.member).toEqual(
      expect.arrayContaining(['runs:read', 'runs:write', 'alerts:manage']),
    );
    expect(ROLE_SCOPES.member.includes('tokens:manage' as never)).toBe(false);
    expect(ROLE_SCOPES.member.includes('audit:read' as never)).toBe(false);
  });
});

describe('validateApiToken — bootstrap fallback', () => {
  it('accepts the bootstrap env-var when no users exist yet', async () => {
    const { db } = makeAuthDb({ users: [], tokenRow: null });
    const out = await validateApiToken('Bearer bootstrap-secret', db, {
      bootstrapToken: 'bootstrap-secret',
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.role).toBe('admin');
      expect(out.bootstrap).toBe(true);
    }
  });

  it('rejects the bootstrap token once any user exists', async () => {
    const { db } = makeAuthDb({ users: [{ id: 'u1' }], tokenRow: null });
    const out = await validateApiToken('Bearer bootstrap-secret', db, {
      bootstrapToken: 'bootstrap-secret',
    });
    expect(out.ok).toBe(false);
  });

  it('rejects bootstrap with the wrong secret', async () => {
    const { db } = makeAuthDb({ users: [], tokenRow: null });
    const out = await validateApiToken('Bearer wrong', db, {
      bootstrapToken: 'right',
    });
    expect(out).toEqual({ ok: false, reason: 'bad-token' });
  });

  it('reports missing-header when no header is sent and DB is empty', async () => {
    const { db } = makeAuthDb({ users: [], tokenRow: null });
    const out = await validateApiToken(null, db, { bootstrapToken: 'anything' });
    expect(out).toEqual({ ok: false, reason: 'missing-header' });
  });
});

describe('validateApiToken — real tokens', () => {
  it('accepts a valid token and returns the user role + intersected scopes', async () => {
    const minted = await mintToken();
    const { db, updateCalled } = makeAuthDb({
      users: [{ id: 'u1' }],
      tokenRow: {
        id: minted.id,
        userId: 'u1',
        role: 'member',
        hash: minted.hash,
        // Token declares more than its role allows — verify intersection.
        scopes: ['runs:read', 'runs:write', 'tokens:manage'],
        expiresAt: null,
        revokedAt: null,
      },
    });
    const out = await validateApiToken(`Bearer ${minted.plaintext}`, db);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.userId).toBe('u1');
      expect(out.role).toBe('member');
      // Member can't manage tokens — intersection drops it.
      expect([...out.scopes].sort()).toEqual(['runs:read', 'runs:write']);
    }
    expect(updateCalled.value).toBe(true);
  });

  it('rejects when the prefix isn\'t found', async () => {
    const minted = await mintToken();
    const { db } = makeAuthDb({ users: [{ id: 'u1' }], tokenRow: null });
    const out = await validateApiToken(`Bearer ${minted.plaintext}`, db);
    expect(out).toEqual({ ok: false, reason: 'bad-token' });
  });

  it('rejects when the secret\'s bcrypt verify fails', async () => {
    const minted = await mintToken();
    const other = await mintToken();
    const { db } = makeAuthDb({
      users: [{ id: 'u1' }],
      tokenRow: {
        id: 'tok',
        userId: 'u1',
        role: 'admin',
        hash: other.hash, // wrong hash for `minted`
        scopes: ['runs:read'],
        expiresAt: null,
        revokedAt: null,
      },
    });
    const out = await validateApiToken(`Bearer ${minted.plaintext}`, db);
    expect(out).toEqual({ ok: false, reason: 'bad-token' });
  });

  it('returns insufficient-scope when the requested scope is filtered out', async () => {
    const minted = await mintToken();
    const { db } = makeAuthDb({
      users: [{ id: 'u1' }],
      tokenRow: {
        id: 'tok',
        userId: 'u1',
        role: 'viewer',
        hash: minted.hash,
        scopes: ['runs:read', 'runs:write'], // role filters write out
        expiresAt: null,
        revokedAt: null,
      },
    });
    const out = await validateApiToken(`Bearer ${minted.plaintext}`, db, {
      requiredScope: 'runs:write',
    });
    expect(out).toEqual({ ok: false, reason: 'insufficient-scope' });
  });

  it('skips the lastUsedAt update when touchLastUsed:false', async () => {
    const minted = await mintToken();
    const { db, updateCalled } = makeAuthDb({
      users: [{ id: 'u1' }],
      tokenRow: {
        id: 'tok',
        userId: 'u1',
        role: 'admin',
        hash: minted.hash,
        scopes: ['runs:read'],
        expiresAt: null,
        revokedAt: null,
      },
    });
    await validateApiToken(`Bearer ${minted.plaintext}`, db, {
      touchLastUsed: false,
    });
    expect(updateCalled.value).toBe(false);
  });

  it('rejects a malformed Bearer payload as bad-token', async () => {
    const { db } = makeAuthDb({ users: [{ id: 'u1' }], tokenRow: null });
    const out = await validateApiToken('Bearer not-a-drift-token', db);
    expect(out).toEqual({ ok: false, reason: 'bad-token' });
  });

  it('rejects a non-Bearer scheme as bad-scheme', async () => {
    const { db } = makeAuthDb({ users: [{ id: 'u1' }], tokenRow: null });
    const out = await validateApiToken('Basic abc', db);
    expect(out).toEqual({ ok: false, reason: 'bad-scheme' });
  });

  it('rejects a missing header as missing-header', async () => {
    const { db } = makeAuthDb({ users: [{ id: 'u1' }], tokenRow: null });
    const out = await validateApiToken(null, db);
    expect(out).toEqual({ ok: false, reason: 'missing-header' });
  });
});

describe('validateIngestAuth (back-compat)', () => {
  it('rejects when DRIFT_INGEST_TOKEN is unset (closed by default)', () => {
    expect(validateIngestAuth('Bearer anything', undefined)).toEqual({
      ok: false,
      reason: 'no-token-configured',
    });
    expect(validateIngestAuth('Bearer anything', '')).toEqual({
      ok: false,
      reason: 'no-token-configured',
    });
  });

  it('accepts a matching bearer token', () => {
    expect(validateIngestAuth('Bearer s3cret', 's3cret')).toEqual({ ok: true });
  });

  it('rejects a missing Authorization header', () => {
    expect(validateIngestAuth(null, 's3cret')).toEqual({
      ok: false,
      reason: 'missing-header',
    });
  });

  it('rejects a non-Bearer scheme', () => {
    expect(validateIngestAuth('Basic s3cret', 's3cret')).toEqual({
      ok: false,
      reason: 'bad-scheme',
    });
  });

  it('is case-insensitive on the "Bearer" scheme keyword', () => {
    expect(validateIngestAuth('bearer s3cret', 's3cret')).toEqual({ ok: true });
    expect(validateIngestAuth('BEARER s3cret', 's3cret')).toEqual({ ok: true });
  });

  it('rejects a wrong token', () => {
    expect(validateIngestAuth('Bearer wrong', 's3cret')).toEqual({
      ok: false,
      reason: 'bad-token',
    });
  });

  it('rejects a Bearer header with no token part', () => {
    expect(validateIngestAuth('Bearer', 's3cret')).toEqual({
      ok: false,
      reason: 'bad-token',
    });
    expect(validateIngestAuth('Bearer ', 's3cret')).toEqual({
      ok: false,
      reason: 'bad-token',
    });
  });

  it('treats tokens of different lengths as no-match without timing leak', () => {
    // We can't observe timing here, but we can at least confirm the
    // short-circuit on length mismatch still returns bad-token.
    expect(validateIngestAuth('Bearer short', 'much-longer-secret')).toEqual({
      ok: false,
      reason: 'bad-token',
    });
  });
});
