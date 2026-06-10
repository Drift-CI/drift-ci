import { describe, it, expect } from 'vitest';
import {
  clampLimit,
  decodeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  MAX_PAGE_SIZE,
} from '../cursor';

describe('encodeCursor / decodeCursor', () => {
  it('roundtrips through base64url', () => {
    const cur = {
      startedAt: '2026-04-25T00:00:00.000Z',
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    };
    expect(decodeCursor(encodeCursor(cur))).toEqual(cur);
  });

  it('decodes null/undefined to null', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('rejects non-base64 garbage', () => {
    expect(decodeCursor('not-a-cursor!!!')).toBeNull();
  });

  it('rejects valid base64 that does not decode to the expected shape', () => {
    expect(
      decodeCursor(Buffer.from('"hello"', 'utf8').toString('base64url')),
    ).toBeNull();
    expect(
      decodeCursor(
        Buffer.from(JSON.stringify({ id: 'x' }), 'utf8').toString('base64url'),
      ),
    ).toBeNull();
  });

  it('produces URL-safe output (no +, /, or =)', () => {
    const big = encodeCursor({
      startedAt: '2026-04-25T00:00:00.000Z',
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    });
    expect(big).not.toMatch(/[+/=]/);
  });
});

describe('clampLimit', () => {
  it('returns the default when missing', () => {
    expect(clampLimit(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit('')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('clamps to MAX_PAGE_SIZE when too large', () => {
    expect(clampLimit('500')).toBe(MAX_PAGE_SIZE);
  });

  it('falls back to default when zero, negative, or non-numeric', () => {
    expect(clampLimit('0')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit('-5')).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit('xyz')).toBe(DEFAULT_PAGE_SIZE);
  });

  it('passes valid limits through unchanged', () => {
    expect(clampLimit('10')).toBe(10);
    expect(clampLimit('50')).toBe(50);
  });
});
