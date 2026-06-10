import { describe, it, expect } from 'vitest';
import { checkOrigin } from '../origin';

function req(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, { method, headers });
}

describe('checkOrigin', () => {
  it('passes safe methods without inspecting headers', () => {
    expect(checkOrigin(req('GET', 'https://dash.example/x')).ok).toBe(true);
    expect(checkOrigin(req('HEAD', 'https://dash.example/x')).ok).toBe(true);
    expect(checkOrigin(req('OPTIONS', 'https://dash.example/x')).ok).toBe(true);
  });

  it('rejects POST without an Origin or Sec-Fetch-Site header', () => {
    const out = checkOrigin(req('POST', 'https://dash.example/x'));
    expect(out).toEqual({ ok: false, reason: 'missing-origin' });
  });

  it('accepts POST when Sec-Fetch-Site is `none` (page nav from address bar)', () => {
    const out = checkOrigin(
      req('POST', 'https://dash.example/x', { 'sec-fetch-site': 'none' }),
    );
    expect(out.ok).toBe(true);
  });

  it('accepts POST when Sec-Fetch-Site is `same-origin`', () => {
    const out = checkOrigin(
      req('POST', 'https://dash.example/x', { 'sec-fetch-site': 'same-origin' }),
    );
    expect(out.ok).toBe(true);
  });

  it('accepts a same-host Origin header', () => {
    const out = checkOrigin(
      req('POST', 'https://dash.example/x', {
        origin: 'https://dash.example',
      }),
    );
    expect(out.ok).toBe(true);
  });

  it('rejects a cross-origin Origin header', () => {
    const out = checkOrigin(
      req('POST', 'https://dash.example/x', {
        origin: 'https://evil.example',
      }),
    );
    expect(out).toEqual({ ok: false, reason: 'cross-origin' });
  });

  it('treats DELETE the same as POST', () => {
    const out = checkOrigin(req('DELETE', 'https://dash.example/x'));
    expect(out).toEqual({ ok: false, reason: 'missing-origin' });
  });
});
