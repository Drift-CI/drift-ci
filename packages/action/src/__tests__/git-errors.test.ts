import { describe, it, expect } from 'vitest';

import { isMissingAtRevision } from '../git-errors.js';

describe('isMissingAtRevision', () => {
  it('recognises both git "missing path" messages', () => {
    expect(isMissingAtRevision("fatal: path 'x' does not exist in 'abc'")).toBe(true);
    expect(isMissingAtRevision("fatal: path 'x' exists on disk, but not in 'abc'")).toBe(true);
  });
  it('rejects other failures', () => {
    expect(isMissingAtRevision('fatal: bad object abc')).toBe(false);
    expect(isMissingAtRevision('')).toBe(false);
  });
});
