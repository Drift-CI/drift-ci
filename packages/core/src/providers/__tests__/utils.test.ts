import { describe, it, expect, vi } from 'vitest';
import { isRateLimitError, withRetry } from '../utils.js';

describe('isRateLimitError', () => {
  it('catches HTTP 429 and 503', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 503 })).toBe(true);
  });

  it('catches message-based rate-limit errors', () => {
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('Too Many Requests'))).toBe(true);
  });

  it('does not treat random errors as rate limits', () => {
    expect(isRateLimitError(new Error('auth failed'))).toBe(false);
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns the result without retry on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('auth failed'));
    await expect(withRetry(fn)).rejects.toThrow('auth failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries rate-limit errors up to maxRetries', async () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 });
    const fn = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');
    const sleeps: number[] = [];
    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelayMs: 10,
      jitterMs: 0,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('rethrows the last error after exhausting retries', async () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      withRetry(fn, {
        maxRetries: 2,
        initialDelayMs: 1,
        jitterMs: 0,
        sleep: async () => {},
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps backoff at maxDelayMs', async () => {
    const err = Object.assign(new Error('429'), { status: 429 });
    const fn = vi.fn().mockRejectedValue(err);
    const sleeps: number[] = [];
    await withRetry(fn, {
      maxRetries: 4,
      initialDelayMs: 1000,
      maxDelayMs: 1500,
      jitterMs: 0,
      sleep: async (ms) => void sleeps.push(ms),
    }).catch(() => {});
    expect(sleeps).toEqual([1000, 1500, 1500, 1500]);
  });

  it('accepts a custom isRetryable predicate', async () => {
    const err = new Error('quota');
    const fn = vi
      .fn<[], Promise<string>>()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');
    const result = await withRetry(fn, {
      maxRetries: 2,
      initialDelayMs: 1,
      jitterMs: 0,
      sleep: async () => {},
      isRetryable: (e) => (e as Error).message === 'quota',
    });
    expect(result).toBe('ok');
  });
});
