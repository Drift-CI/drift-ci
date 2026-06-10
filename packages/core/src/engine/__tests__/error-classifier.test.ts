import { describe, it, expect } from 'vitest';
import { classifyError } from '../error-classifier.js';

function withStatus(status: number, message = 'http error'): Error {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
}

function withCode(code: string, message = ''): Error {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

describe('classifyError', () => {
  it('classifies 429 as rate limit', () => {
    expect(classifyError(withStatus(429))).toBe('provider-rate-limit');
  });

  it('classifies a "rate limit" message as rate limit', () => {
    expect(classifyError(new Error('rate limit exceeded'))).toBe(
      'provider-rate-limit',
    );
  });

  it('classifies 401/403 as auth', () => {
    expect(classifyError(withStatus(401))).toBe('provider-auth');
    expect(classifyError(withStatus(403))).toBe('provider-auth');
  });

  it('classifies 5xx and network codes as network', () => {
    expect(classifyError(withStatus(500))).toBe('provider-network');
    expect(classifyError(withStatus(503))).toBe('provider-network');
    expect(classifyError(withCode('ECONNRESET'))).toBe('provider-network');
    expect(classifyError(withCode('ENOTFOUND'))).toBe('provider-network');
    expect(classifyError(new Error('fetch failed'))).toBe('provider-network');
  });

  it('classifies TIMEOUT code and "timeout" messages as timeout', () => {
    expect(classifyError(withCode('TIMEOUT', 'Timeout'))).toBe('timeout');
    expect(classifyError(new Error('Request timeout'))).toBe('timeout');
  });

  it('falls back to evaluator-error for unknown shapes', () => {
    expect(classifyError(new Error('unexpected boom'))).toBe(
      'evaluator-error',
    );
  });

  it('prefers response.status when top-level status is absent', () => {
    const e = new Error('server error') as Error & {
      response: { status: number };
    };
    e.response = { status: 502 };
    expect(classifyError(e)).toBe('provider-network');
  });
});
