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

  it.each([
    ['project', `sk-proj-${'Ab1_-'.repeat(30)}`],
    ['service account', `sk-svcacct-${'Zz9'.repeat(30)}`],
    ['admin', `sk-admin-${'q'.repeat(60)}`],
  ])('redacts current OpenAI %s keys', (_label, key) => {
    const { text, redactions } = redactSecrets(`OPENAI_API_KEY=${key} end`);
    expect(text).toBe('OPENAI_API_KEY=[REDACTED:openai-key] end');
    expect(redactions).toEqual([{ kind: 'openai-key', count: 1 }]);
  });

  it.each([
    ['personal', `ghp_${'a1B2'.repeat(9)}`],
    ['OAuth', `gho_${'a1B2'.repeat(9)}`],
    ['server', `ghs_${'a1B2'.repeat(9)}`],
    ['fine-grained', `github_pat_${'A1b2_'.repeat(16)}`],
  ])('redacts GitHub %s tokens', (_label, token) => {
    const { text, redactions } = redactSecrets(`token ${token} here`);
    expect(text).toBe('token [REDACTED:github-token] here');
    expect(redactions).toEqual([{ kind: 'github-token', count: 1 }]);
  });

  it.each([
    // Built at runtime so no token-shaped literal sits in the source (push protection).
    ['bot', ['xoxb', '1'.repeat(10), '2'.repeat(13), 'Ab'.repeat(12)].join('-')],
    ['user', ['xoxp', '1'.repeat(10), '2'.repeat(10), '3'.repeat(13), 'f0'.repeat(16)].join('-')],
  ])('redacts Slack %s tokens', (_label, token) => {
    const { text, redactions } = redactSecrets(`slack ${token}`);
    expect(text).toBe('slack [REDACTED:slack-token]');
    expect(redactions).toEqual([{ kind: 'slack-token', count: 1 }]);
  });

  it('redacts an OpenAI key glued to an underscore-joined name', () => {
    const { text } = redactSecrets(`OPENAI_KEY_sk-proj-${'x'.repeat(40)}`);
    expect(text).toBe('OPENAI_KEY_[REDACTED:openai-key]');
  });

  it('leaves ordinary words that start like key prefixes alone', () => {
    const input = 'the sk-proj- prefix, ghp_ short, xoxb- alone, task-admin-panel';
    const { text, redactions } = redactSecrets(input);
    expect(text).toBe(input);
    expect(redactions).toEqual([]);
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

  it('still redacts a JWT that follows punctuation or a space', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcXYZ-_123';
    expect(redactSecrets(`token=${jwt}`).text).toBe('token=[REDACTED:jwt]');
    expect(redactSecrets(`"${jwt}"`).text).toBe('"[REDACTED:jwt]"');
  });

  it('redacts several private keys and leaves text after the last END alone', () => {
    const key = ['-----BEGIN PRIVATE KEY-----', 'abc', '-----END PRIVATE KEY-----'].join(String.fromCharCode(10));
    const { text, redactions } = redactSecrets(`${key} mid ${key} tail -----BEGIN PRIVATE KEY----- no end`);
    expect(text).toBe('[REDACTED:rsa-private-key] mid [REDACTED:rsa-private-key] tail -----BEGIN PRIVATE KEY----- no end');
    expect(redactions).toEqual([{ kind: 'rsa-private-key', count: 2 }]);
  });

  it.each([
    ['repeated JWT prefixes', 'eyJ'.repeat(300_000)],
    ['repeated PEM headers with no END', '-----BEGIN PRIVATE KEY-----'.repeat(40_000)],
    ['PEM headers then one END at the start', '-----END PRIVATE KEY-----' + '-----BEGIN PRIVATE KEY-----'.repeat(40_000)],
    ['repeated key prefixes', 'sk-ant-sk-proj-ghp_xoxb-'.repeat(40_000)],
  ])('runs in linear time on %s (about 1 MB)', (_label, input) => {
    const start = Date.now();
    redactSecrets(input);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
