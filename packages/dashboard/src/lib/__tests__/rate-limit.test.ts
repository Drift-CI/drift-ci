import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetRateLimitForTests,
  rateLimit,
} from '../rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it('allows the first N requests up to the limit', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      const r = await rateLimit({
        key: 'k1',
        limit: 5,
        windowMs: 60_000,
        now: t0,
      });
      expect(r.allowed).toBe(true);
    }
  });

  it('rejects the (limit + 1)th request inside the window', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      await rateLimit({ key: 'k2', limit: 5, windowMs: 60_000, now: t0 });
    }
    const blocked = await rateLimit({
      key: 'k2',
      limit: 5,
      windowMs: 60_000,
      now: t0,
    });
    expect(blocked.allowed).toBe(false);
  });

  it('refills proportionally as time passes', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      await rateLimit({ key: 'k3', limit: 5, windowMs: 60_000, now: t0 });
    }
    // Half the window passes — half the bucket is back.
    const half = await rateLimit({
      key: 'k3',
      limit: 5,
      windowMs: 60_000,
      now: t0 + 30_000,
    });
    expect(half.allowed).toBe(true);
    expect(half.remaining).toBeGreaterThanOrEqual(1);
  });

  it('fully refills after a full window', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      await rateLimit({ key: 'k4', limit: 5, windowMs: 60_000, now: t0 });
    }
    const after = await rateLimit({
      key: 'k4',
      limit: 5,
      windowMs: 60_000,
      now: t0 + 60_000,
    });
    expect(after.allowed).toBe(true);
    // After consuming one of five fresh tokens, four remain.
    expect(after.remaining).toBe(4);
  });

  it('keeps separate buckets per key', async () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      await rateLimit({ key: 'a', limit: 5, windowMs: 60_000, now: t0 });
    }
    const blockedA = await rateLimit({ key: 'a', limit: 5, windowMs: 60_000, now: t0 });
    const stillOpenB = await rateLimit({ key: 'b', limit: 5, windowMs: 60_000, now: t0 });
    expect(blockedA.allowed).toBe(false);
    expect(stillOpenB.allowed).toBe(true);
  });

  it('reports a resetAt aligned with the next refill', async () => {
    const t0 = 1_000_000;
    const r = await rateLimit({ key: 'k5', limit: 1, windowMs: 30_000, now: t0 });
    expect(r.allowed).toBe(true);
    expect(r.resetAt).toBe(t0 + 30_000);
  });
});
