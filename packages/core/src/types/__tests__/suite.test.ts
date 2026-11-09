import { describe, expect, it } from 'vitest';
import { SuiteSchema } from '../suite.js';

const base = {
  version: 1,
  id: 's',
  name: 'S',
  cases: [{ id: 'c1', input: 'hi', expected: 'hi' }],
};

describe('SuiteSchema default_runs', () => {
  it('is optional', () => {
    expect(SuiteSchema.parse(base).default_runs).toBeUndefined();
  });

  it('accepts 1 to 5', () => {
    expect(SuiteSchema.parse({ ...base, default_runs: 3 }).default_runs).toBe(3);
    expect(SuiteSchema.parse({ ...base, default_runs: 1 }).default_runs).toBe(1);
    expect(SuiteSchema.parse({ ...base, default_runs: 5 }).default_runs).toBe(5);
  });

  it('rejects 0, 6 and non-integers', () => {
    expect(SuiteSchema.safeParse({ ...base, default_runs: 0 }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...base, default_runs: 6 }).success).toBe(false);
    expect(SuiteSchema.safeParse({ ...base, default_runs: 2.5 }).success).toBe(false);
  });
});
