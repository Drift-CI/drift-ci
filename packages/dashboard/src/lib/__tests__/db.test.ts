import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { __resetDbForTests, getDb, pingDb } from '../db';

describe('getDb', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    await __resetDbForTests();
  });

  afterEach(async () => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await __resetDbForTests();
  });

  it('throws a clear error when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    expect(() => getDb()).toThrowError(/DATABASE_URL/);
  });

  it('caches the client across calls', () => {
    // Use an unreachable-but-well-formed URL — postgres-js doesn't
    // connect until a query runs, so this just exercises the cache.
    process.env.DATABASE_URL = 'postgres://drift:drift@127.0.0.1:59999/drift_ci';
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
  });
});

describe('pingDb', () => {
  const originalUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    await __resetDbForTests();
  });

  afterEach(async () => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await __resetDbForTests();
  });

  it('resolves to { ok: false, error } when the DB is unreachable', async () => {
    // Port 59999 is reserved-ish on most hosts; connection refuses fast.
    process.env.DATABASE_URL = 'postgres://drift:drift@127.0.0.1:59999/drift_ci';
    const out = await pingDb();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/./);
  }, 15_000);

  it('resolves to { ok: false, error } when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL;
    const out = await pingDb();
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/DATABASE_URL/);
  });
});
