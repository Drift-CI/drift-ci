import { describe, it, expect } from 'vitest';
import {
  constantTimeEquals,
  mintToken,
  parseAuthHeader,
  parseTokenString,
  TOKEN_PATTERN,
  verifyTokenHash,
} from '../tokens';

describe('mintToken', () => {
  it('produces a drift_<8>_<32> plaintext token matching the public pattern', async () => {
    const t = await mintToken();
    expect(t.plaintext).toMatch(TOKEN_PATTERN);
    expect(t.prefix).toHaveLength(8);
  });

  it('produces a bcrypt hash that verifies via verifyTokenHash', async () => {
    const t = await mintToken();
    const parsed = parseTokenString(t.plaintext);
    expect(parsed).not.toBeNull();
    await expect(verifyTokenHash(parsed!, t.hash)).resolves.toBe(true);
  });

  it('emits unique secrets across calls', async () => {
    const a = await mintToken();
    const b = await mintToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.prefix).not.toBe(b.prefix);
  });

  it('assigns each token a fresh UUID id', async () => {
    const a = await mintToken();
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('parseTokenString', () => {
  it('rejects null/undefined/empty', () => {
    expect(parseTokenString(null)).toBeNull();
    expect(parseTokenString(undefined)).toBeNull();
    expect(parseTokenString('')).toBeNull();
  });

  it('rejects tokens missing the drift_ namespace', () => {
    expect(parseTokenString('xxx_aaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeNull();
  });

  it('rejects tokens with the wrong prefix length', () => {
    expect(parseTokenString('drift_abc_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeNull();
  });

  it('rejects tokens with the wrong secret length', () => {
    expect(parseTokenString('drift_aaaaaaaa_short')).toBeNull();
  });

  it('accepts a well-shaped token', () => {
    const ok = parseTokenString('drift_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(ok).toEqual({
      prefix: 'AAAAAAAA',
      secret: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
  });
});

describe('parseAuthHeader', () => {
  it('returns null when header is null', () => {
    expect(parseAuthHeader(null)).toBeNull();
  });

  it('returns null on a non-Bearer scheme', () => {
    expect(
      parseAuthHeader('Basic drift_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
    ).toBeNull();
  });

  it('extracts a parsed token from a Bearer header', () => {
    expect(
      parseAuthHeader('Bearer drift_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
    ).toEqual({
      prefix: 'AAAAAAAA',
      secret: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    });
  });

  it('is case-insensitive on the scheme keyword', () => {
    expect(
      parseAuthHeader('bearer drift_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
    ).not.toBeNull();
    expect(
      parseAuthHeader('BEARER drift_AAAAAAAA_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
    ).not.toBeNull();
  });
});

describe('verifyTokenHash', () => {
  it('returns false on a mismatching prefix or secret', async () => {
    const t = await mintToken();
    const parsed = parseTokenString(t.plaintext)!;
    await expect(verifyTokenHash(parsed, 'totally-not-a-bcrypt-hash')).resolves.toBe(
      false,
    );
    const swapped = { prefix: parsed.prefix, secret: 'X'.repeat(32) };
    await expect(verifyTokenHash(swapped, t.hash)).resolves.toBe(false);
  });
});

describe('constantTimeEquals', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true);
  });

  it('returns false for unequal strings of equal length', () => {
    expect(constantTimeEquals('abc', 'abd')).toBe(false);
  });

  it('returns false fast for unequal lengths', () => {
    expect(constantTimeEquals('a', 'aa')).toBe(false);
  });
});
