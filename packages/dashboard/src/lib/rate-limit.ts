/**
 * Per-key token-bucket rate limiter.
 *
 * In-memory, per-process. Adequate for self-hosted single-instance
 * deployments — which is every drift-ci dashboard install today.
 * Multi-instance deployments would need a Redis or Postgres backend;
 * we'd swap the `STORE` map without changing call-sites.
 *
 * The bucket has capacity = `limit` and refills `limit` tokens every
 * `windowMs`. Each call consumes one token; when the bucket is dry,
 * the request is rejected and the caller backs off.
 */

interface Bucket {
  tokens: number;
  /** Last refill timestamp, ms since epoch. */
  refilledAt: number;
}

interface Sample {
  bucket: Bucket;
  hits: number;
}

const STORE = new Map<string, Sample>();

// Stored buckets older than this are reaped on the next access. Keeps
// the map bounded against an attacker who fans IPs out across keyspace.
const STALE_AFTER_MS = 60 * 60 * 1000;

export interface RateLimitInput {
  key: string;
  /** Tokens (allowed requests) per window. */
  limit: number;
  /** Window in milliseconds. */
  windowMs: number;
  /** Override clock for tests. */
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Tokens left after this request. */
  remaining: number;
  /** Window expires at this absolute ms timestamp. */
  resetAt: number;
}

/**
 * Synchronous implementation — the helper is `async` so we can swap
 * a Redis backend later without touching call-sites.
 */
export async function rateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const now = input.now ?? Date.now();
  reapStaleBuckets(now);

  const sample = STORE.get(input.key) ?? {
    bucket: { tokens: input.limit, refilledAt: now },
    hits: 0,
  };

  // Refill: linear, proportional to time elapsed since last refill.
  const elapsed = now - sample.bucket.refilledAt;
  if (elapsed >= input.windowMs) {
    sample.bucket.tokens = input.limit;
    sample.bucket.refilledAt = now;
  } else if (elapsed > 0) {
    const refilled = (elapsed / input.windowMs) * input.limit;
    sample.bucket.tokens = Math.min(
      input.limit,
      sample.bucket.tokens + refilled,
    );
    sample.bucket.refilledAt = now;
  }

  let allowed: boolean;
  if (sample.bucket.tokens >= 1) {
    sample.bucket.tokens -= 1;
    sample.hits += 1;
    allowed = true;
  } else {
    allowed = false;
  }

  STORE.set(input.key, sample);

  return {
    allowed,
    remaining: Math.floor(sample.bucket.tokens),
    resetAt: sample.bucket.refilledAt + input.windowMs,
  };
}

function reapStaleBuckets(now: number): void {
  if (STORE.size < 128) return; // cheap heuristic: only reap when needed
  for (const [key, sample] of STORE.entries()) {
    if (now - sample.bucket.refilledAt > STALE_AFTER_MS) {
      STORE.delete(key);
    }
  }
}

/** Test hook: clear the in-memory store. */
export function __resetRateLimitForTests(): void {
  STORE.clear();
}
