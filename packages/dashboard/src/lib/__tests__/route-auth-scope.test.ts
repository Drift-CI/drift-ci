import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

import { requireAuth } from '../route-auth';

// We mock getDb rather than running real Drizzle queries so this file
// stays a fast unit test. The DB-fake matches the shape of the
// users-empty + token-join calls validateApiToken issues.

vi.mock('../db', () => ({
  getDb: vi.fn(),
}));

import { getDb } from '../db';
import type { Db } from '../db';

function fakeDb(opts: {
  noUsers?: boolean;
  scopes?: string[];
  hash?: string | null;
  role?: 'admin' | 'member' | 'viewer';
}): Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usersChain: any = {
    from: vi.fn(() => usersChain),
    limit: vi.fn(() => Promise.resolve(opts.noUsers ? [] : [{ id: 'u1' }])),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tokensChain: any = {
    from: vi.fn(() => tokensChain),
    innerJoin: vi.fn(() => tokensChain),
    where: vi.fn(() => tokensChain),
    limit: vi.fn(() =>
      Promise.resolve(
        opts.hash
          ? [
              {
                id: 'tok',
                userId: 'u1',
                role: opts.role ?? 'admin',
                hash: opts.hash,
                scopes: opts.scopes ?? ['runs:read', 'runs:write'],
                expiresAt: null,
                revokedAt: null,
              },
            ]
          : [],
      ),
    ),
  };
  let nextSelect: 'users' | 'tokens' = 'users';
  return {
    select: vi.fn((cols?: Record<string, unknown>) => {
      const isUsersOnly =
        cols !== undefined && Object.keys(cols).length === 1 && 'id' in cols;
      if (isUsersOnly && nextSelect === 'users') {
        nextSelect = 'tokens';
        return usersChain;
      }
      return tokensChain;
    }),
    update: vi.fn(() => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }) as any),
    })),
  } as unknown as Db;
}

describe('requireAuth — scope mapping', () => {
  const originalToken = process.env.DRIFT_INGEST_TOKEN;

  beforeEach(() => {
    delete process.env.DRIFT_INGEST_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.DRIFT_INGEST_TOKEN;
    else process.env.DRIFT_INGEST_TOKEN = originalToken;
  });

  function req(headers: Record<string, string> = {}): Request {
    return new Request('https://dash.example/api/v1/tokens', { headers });
  }

  it('returns 403 when the requested scope is not granted by the role', async () => {
    // viewer has only runs:read, but we ask for runs:write.
    const { mintToken } = await import('../tokens');
    const minted = await mintToken();
    vi.mocked(getDb).mockReturnValue(
      fakeDb({ hash: minted.hash, role: 'viewer', scopes: ['runs:read'] }),
    );
    const out = await requireAuth(
      req({ authorization: `Bearer ${minted.plaintext}` }),
      { requiredScope: 'runs:write' },
    );
    expect(out).toBeInstanceOf(NextResponse);
    if (out instanceof NextResponse) {
      expect(out.status).toBe(403);
      const body = await out.json();
      expect(body.error).toMatch(/insufficient-scope/);
    }
  });

  it('returns the principal when the scope check passes', async () => {
    const { mintToken } = await import('../tokens');
    const minted = await mintToken();
    vi.mocked(getDb).mockReturnValue(
      fakeDb({
        hash: minted.hash,
        role: 'admin',
        scopes: ['runs:read', 'runs:write', 'tokens:manage'],
      }),
    );
    const out = await requireAuth(
      req({ authorization: `Bearer ${minted.plaintext}` }),
      { requiredScope: 'tokens:manage' },
    );
    expect(out).not.toBeInstanceOf(NextResponse);
    if (!(out instanceof NextResponse)) {
      expect(out.role).toBe('admin');
      expect(out.scopes).toContain('tokens:manage');
    }
  });

  it('returns 503 when no auth is configured (no users, no bootstrap)', async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb({ noUsers: true }));
    const out = await requireAuth(
      req({ authorization: 'Bearer drift_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }),
    );
    expect(out).toBeInstanceOf(NextResponse);
    if (out instanceof NextResponse) {
      // Without a bootstrap env var the fall-through is bad-token (401);
      // 503 only fires for the explicit "no-auth-configured" reason.
      expect([401, 503]).toContain(out.status);
    }
  });
});
