import { describe, it, expect } from 'vitest';

import { stripTrailingSlashes } from '../url.js';

describe('stripTrailingSlashes', () => {
  it('removes one or more trailing slashes', () => {
    expect(stripTrailingSlashes('http://x/')).toBe('http://x');
    expect(stripTrailingSlashes('http://x///')).toBe('http://x');
    expect(stripTrailingSlashes('http://x/a/')).toBe('http://x/a');
  });

  it('leaves slash-free, interior-slash, and edge inputs alone', () => {
    expect(stripTrailingSlashes('http://x')).toBe('http://x');
    expect(stripTrailingSlashes('a//b')).toBe('a//b');
    expect(stripTrailingSlashes('')).toBe('');
    expect(stripTrailingSlashes('/')).toBe('');
  });

  it('handles a pathological all-slashes run in linear time (ReDoS guard)', () => {
    // The previous `replace(/\/+$/, '')` was O(n^2) on a long slash run that is
    // not at the end, because the unanchored greedy `\/+` retries from every
    // position. This input ends with a non-slash, so nothing is stripped — the
    // linear scan must return it (unchanged) effectively instantly.
    const evil = `http://x${'/'.repeat(200_000)}a`;
    const start = performance.now();
    expect(stripTrailingSlashes(evil)).toBe(evil);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
