import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../redaction.js';

describe('redactSecrets', () => {
  it('returns text unchanged and empty counts when no secrets present', () => {
    const { text, redactions } = redactSecrets('hello world, no secrets here');
    expect(text).toBe('hello world, no secrets here');
    expect(redactions).toEqual([]);
  });

  it('redacts AWS access keys and counts them', () => {
    const input = 'AKIAIOSFODNN7EXAMPLE and AKIA1234567890ABCDEF mixed';
    const { text, redactions } = redactSecrets(input);
    expect(text).not.toContain('AKIA');
    expect(text).toContain('[REDACTED:aws-key]');
    expect(redactions).toEqual([{ kind: 'aws-key', count: 2 }]);
  });

  it('redacts Anthropic API keys', () => {
    const input = 'token sk-ant-api03-abcdef1234567890 in payload';
    const { text, redactions } = redactSecrets(input);
    expect(text).toContain('[REDACTED:anthropic-key]');
    expect(text).not.toContain('sk-ant-api03');
    expect(redactions).toEqual([{ kind: 'anthropic-key', count: 1 }]);
  });

  it('redacts OpenAI keys (48 alphanumeric chars after sk-)', () => {
    const key = 'sk-' + 'a'.repeat(48);
    const { text, redactions } = redactSecrets(`key=${key}`);
    expect(text).toBe('key=[REDACTED:openai-key]');
    expect(redactions).toEqual([{ kind: 'openai-key', count: 1 }]);
  });

  it('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcXYZ-_123';
    const { text, redactions } = redactSecrets(`Authorization: Bearer ${jwt}`);
    expect(text).toContain('[REDACTED:jwt]');
    expect(redactions).toEqual([{ kind: 'jwt', count: 1 }]);
  });

  it('redacts RSA private key blocks across newlines', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEpAIBAAKCAQEA1234567890',
      'abcdefghijklmnopqrstuvwxyz',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n');
    const { text, redactions } = redactSecrets(`key:\n${key}\n`);
    expect(text).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(text).toContain('[REDACTED:rsa-private-key]');
    expect(redactions).toEqual([{ kind: 'rsa-private-key', count: 1 }]);
  });

  it('reports counts for each kind when multiple are present', () => {
    const input = `aws=AKIAIOSFODNN7EXAMPLE anth=sk-ant-xyzabc12 jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIi.abcXYZ-_123`;
    const { redactions } = redactSecrets(input);
    const byKind = Object.fromEntries(redactions.map((r) => [r.kind, r.count]));
    expect(byKind['aws-key']).toBe(1);
    expect(byKind['anthropic-key']).toBe(1);
    expect(byKind['jwt']).toBe(1);
  });
});
