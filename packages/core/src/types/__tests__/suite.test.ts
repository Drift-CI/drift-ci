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

describe('TestCase context', () => {
  const withCase = (c: Record<string, unknown>) => ({
    ...base,
    cases: [{ id: 'c1', input: 'q', ...c }],
  });

  it('accepts a string and a list of passages', () => {
    expect(SuiteSchema.safeParse(withCase({ context: 'p1' })).success).toBe(true);
    expect(SuiteSchema.safeParse(withCase({ context: ['p1', 'p2'] })).success).toBe(true);
  });

  it('rejects empty string, empty list, empty passage and more than 20', () => {
    for (const context of ['', [], [''], Array.from({ length: 21 }, () => 'p')]) {
      expect(SuiteSchema.safeParse(withCase({ context })).success).toBe(false);
    }
  });

  it('requires context for the faithfulness evaluator', () => {
    const r = SuiteSchema.safeParse(withCase({ evaluators: ['faithfulness'] }));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain(
      'A case using the `faithfulness` evaluator must define a `context` field.',
    );
    expect(
      SuiteSchema.safeParse(withCase({ evaluators: ['faithfulness'], context: 'p' })).success,
    ).toBe(true);
  });
});
