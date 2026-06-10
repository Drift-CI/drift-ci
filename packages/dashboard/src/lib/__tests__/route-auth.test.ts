import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

import { requireAuth } from '../route-auth';

// requireAuth pulls getDb() — stub it so the unit tests don't try to
// open a real Postgres connection. The DB-fake side of validateApiToken
// is exhaustively covered by auth.test.ts; this file just verifies the
// route-handler wrapper's status mapping.

vi.mock('../db', () => ({
  getDb: vi.fn(() => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })),
    })),
  })),
}));

describe('requireAuth', () => {
  const originalToken = process.env.DRIFT_INGEST_TOKEN;

  beforeEach(() => {
    delete process.env.DRIFT_INGEST_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.DRIFT_INGEST_TOKEN;
    else process.env.DRIFT_INGEST_TOKEN = originalToken;
  });

  function req(headers: Record<string, string> = {}): Request {
    return new Request('https://dash.example/api/v1/runs', { headers });
  }

  it('returns a 401 NextResponse for a missing header', async () => {
    const out = await requireAuth(req());
    expect(out).toBeInstanceOf(NextResponse);
    if (out instanceof NextResponse) {
      expect(out.status).toBe(401);
      const body = await out.json();
      expect(body.error).toMatch(/missing-header/);
    }
  });

  it('returns 401 for a malformed token', async () => {
    const out = await requireAuth(req({ authorization: 'Bearer wrong' }));
    expect(out).toBeInstanceOf(NextResponse);
    if (out instanceof NextResponse) {
      expect(out.status).toBe(401);
    }
  });

  it('returns 401 for a non-Bearer scheme', async () => {
    const out = await requireAuth(req({ authorization: 'Basic abc' }));
    expect(out).toBeInstanceOf(NextResponse);
    if (out instanceof NextResponse) {
      expect(out.status).toBe(401);
      const body = await out.json();
      expect(body.error).toMatch(/bad-scheme/);
    }
  });

  it('honours the bootstrap env var when no users exist', async () => {
    process.env.DRIFT_INGEST_TOKEN = 'bootstrap-secret';
    const out = await requireAuth(req({ authorization: 'Bearer bootstrap-secret' }));
    expect(out).not.toBeInstanceOf(NextResponse);
    if (!(out instanceof NextResponse) && out.ok) {
      expect(out.role).toBe('admin');
      expect(out.bootstrap).toBe(true);
    }
  });
});
