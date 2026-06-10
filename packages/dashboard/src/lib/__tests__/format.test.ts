import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatLatency,
  formatRelative,
  formatScore,
  shortId,
} from '../format';

describe('formatScore', () => {
  it('renders to three decimals', () => {
    expect(formatScore(0.823456)).toBe('0.823');
    expect(formatScore(1)).toBe('1.000');
  });

  it('renders NaN as the em-dash placeholder', () => {
    expect(formatScore(Number.NaN)).toBe('—');
  });

  it('renders Infinity as the em-dash placeholder', () => {
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatLatency', () => {
  it('renders sub-second values as ms', () => {
    expect(formatLatency(123)).toBe('123 ms');
    expect(formatLatency(999.4)).toBe('999 ms');
  });

  it('renders >=1s values as seconds with one decimal', () => {
    expect(formatLatency(1500)).toBe('1.5 s');
    expect(formatLatency(60_000)).toBe('60.0 s');
  });

  it('renders negative or non-finite as em-dash', () => {
    expect(formatLatency(-1)).toBe('—');
    expect(formatLatency(Number.NaN)).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('renders an ISO date as `YYYY-MM-DD HH:mm:ss UTC`', () => {
    expect(formatDateTime('2026-04-25T08:09:10.123Z')).toBe(
      '2026-04-25 08:09:10 UTC',
    );
  });

  it('accepts Date instances', () => {
    expect(formatDateTime(new Date('2026-04-25T00:00:00Z'))).toBe(
      '2026-04-25 00:00:00 UTC',
    );
  });

  it('renders invalid input as em-dash', () => {
    expect(formatDateTime('not a date')).toBe('—');
  });
});

describe('formatRelative', () => {
  const NOW = new Date('2026-04-25T12:00:00Z');

  it('renders sub-minute as seconds', () => {
    expect(formatRelative(new Date('2026-04-25T11:59:30Z'), NOW)).toBe('30s ago');
  });

  it('renders sub-hour as minutes', () => {
    expect(formatRelative(new Date('2026-04-25T11:30:00Z'), NOW)).toBe('30m ago');
  });

  it('renders sub-day as hours', () => {
    expect(formatRelative(new Date('2026-04-25T05:00:00Z'), NOW)).toBe('7h ago');
  });

  it('renders >=1d as days', () => {
    expect(formatRelative(new Date('2026-04-22T12:00:00Z'), NOW)).toBe('3d ago');
  });

  it('renders invalid input as em-dash', () => {
    expect(formatRelative('not a date', NOW)).toBe('—');
  });
});

describe('shortId', () => {
  it('returns the first 8 chars of long ids', () => {
    expect(shortId('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe('f47ac10b');
  });

  it('passes shorter ids through', () => {
    expect(shortId('abc')).toBe('abc');
  });
});
