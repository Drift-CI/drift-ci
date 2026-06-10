export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  sleep?: (ms: number) => Promise<void>;
  isRetryable?: (err: unknown) => boolean;
}

export const DEFAULT_RETRY_OPTIONS: Required<
  Omit<RetryOptions, 'sleep' | 'isRetryable'>
> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  jitterMs: 200,
};

export function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  const code = (err as { code?: string }).code;
  if (status === 429 || status === 503) return true;
  if (code === 'RATE_LIMIT' || code === 'rate_limit_error') return true;
  const message = (err as Error).message ?? '';
  if (/rate limit|too many requests/i.test(message)) return true;
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries,
    initialDelayMs = DEFAULT_RETRY_OPTIONS.initialDelayMs,
    maxDelayMs = DEFAULT_RETRY_OPTIONS.maxDelayMs,
    jitterMs = DEFAULT_RETRY_OPTIONS.jitterMs,
    sleep = defaultSleep,
    isRetryable = isRateLimitError,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) throw err;
      if (attempt === maxRetries) break;

      const delay = Math.min(
        initialDelayMs * Math.pow(2, attempt),
        maxDelayMs,
      );
      const jitter = jitterMs > 0 ? Math.random() * jitterMs : 0;
      await sleep(delay + jitter);
    }
  }
  throw lastError;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
