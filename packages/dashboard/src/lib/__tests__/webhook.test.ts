import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { readEnvelope, verifyGitHubSignature } from '../webhook';

const SECRET = 'webhook-test-secret';

function signedHeader(body: string, secret: string = SECRET): string {
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  return `sha256=${hex}`;
}

describe('verifyGitHubSignature', () => {
  it('rejects when no secret is configured', () => {
    expect(verifyGitHubSignature('{}', 'sha256=abc', undefined)).toEqual({
      ok: false,
      reason: 'no-secret-configured',
    });
    expect(verifyGitHubSignature('{}', 'sha256=abc', '')).toEqual({
      ok: false,
      reason: 'no-secret-configured',
    });
  });

  it('rejects when the signature header is missing', () => {
    expect(verifyGitHubSignature('{}', null, SECRET)).toEqual({
      ok: false,
      reason: 'missing-signature',
    });
    expect(verifyGitHubSignature('{}', undefined, SECRET)).toEqual({
      ok: false,
      reason: 'missing-signature',
    });
  });

  it('rejects malformed signatures (wrong algorithm prefix)', () => {
    expect(verifyGitHubSignature('{}', 'sha1=abc', SECRET)).toEqual({
      ok: false,
      reason: 'malformed-signature',
    });
    expect(verifyGitHubSignature('{}', 'sha256=tooshort', SECRET)).toEqual({
      ok: false,
      reason: 'malformed-signature',
    });
  });

  it('accepts a correct signature over the exact body', () => {
    const body = '{"hello":"world"}';
    expect(verifyGitHubSignature(body, signedHeader(body), SECRET)).toEqual({
      ok: true,
    });
  });

  it('rejects signatures over a different body', () => {
    const body = '{"hello":"world"}';
    expect(
      verifyGitHubSignature('{"different":"body"}', signedHeader(body), SECRET),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects signatures from a different secret', () => {
    const body = '{}';
    expect(
      verifyGitHubSignature(body, signedHeader(body, 'other-secret'), SECRET),
    ).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('is case-insensitive on the hex characters', () => {
    const body = '{}';
    const hex = createHmac('sha256', SECRET)
      .update(body, 'utf8')
      .digest('hex');
    expect(
      verifyGitHubSignature(body, `sha256=${hex.toUpperCase()}`, SECRET),
    ).toEqual({ ok: true });
  });
});

describe('readEnvelope', () => {
  it('extracts the X-GitHub-Event and X-GitHub-Delivery headers', () => {
    const headers = new Headers({
      'X-GitHub-Event': 'pull_request',
      'X-GitHub-Delivery': 'abc-123',
    });
    expect(readEnvelope(headers, { action: 'closed' })).toEqual({
      event: 'pull_request',
      deliveryId: 'abc-123',
      body: { action: 'closed' },
    });
  });

  it('returns "unknown" for missing headers rather than throwing', () => {
    const headers = new Headers();
    expect(readEnvelope(headers, {}).event).toBe('unknown');
    expect(readEnvelope(headers, {}).deliveryId).toBe('unknown');
  });
});
