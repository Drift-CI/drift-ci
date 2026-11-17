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

describe('TestCase and Suite tools', () => {
  const tool = (name: string) => ({ name, parameters: { type: 'object', properties: {} } });
  const withCase = (c: Record<string, unknown>, s: Record<string, unknown> = {}) => ({
    ...base,
    ...s,
    cases: [{ id: 'c1', input: 'q', ...c }],
  });

  it('accepts valid tools on the suite and the case, defaulting parameters', () => {
    const r = SuiteSchema.parse(
      withCase({ tools: [{ name: 'get_order', description: 'Look up' }] }, { tools: [tool('a-b_1')] }),
    );
    expect(r.tools?.[0].name).toBe('a-b_1');
    expect(r.cases[0].tools?.[0].parameters).toEqual({ type: 'object', properties: {} });
  });

  it('rejects bad names, duplicate names and more than 64 tools', () => {
    expect(SuiteSchema.safeParse(withCase({ tools: [tool('has space')] })).success).toBe(false);
    expect(SuiteSchema.safeParse(withCase({ tools: [tool('x'.repeat(65))] })).success).toBe(false);
    expect(SuiteSchema.safeParse(withCase({ tools: [tool('')] })).success).toBe(false);
    const dup = SuiteSchema.safeParse(withCase({}, { tools: [tool('a'), tool('a')] }));
    expect(dup.success).toBe(false);
    expect(JSON.stringify(dup.error?.issues)).toContain('Tool names must be unique.');
    const many = Array.from({ length: 65 }, (_, i) => tool(`t${i}`));
    expect(SuiteSchema.safeParse(withCase({ tools: many })).success).toBe(false);
    expect(SuiteSchema.safeParse(withCase({ tools: many.slice(0, 64) })).success).toBe(true);
  });

  it('rejects a description over 1024 characters', () => {
    expect(
      SuiteSchema.safeParse(withCase({ tools: [{ name: 'a', description: 'x'.repeat(1025) }] })).success,
    ).toBe(false);
  });

  it('accepts expectedCalls, defaulting arguments, and rejects more than 16', () => {
    const r = SuiteSchema.parse(withCase({ expectedCalls: [{ name: 'a' }] }));
    expect(r.cases[0].expectedCalls).toEqual([{ name: 'a', arguments: {} }]);
    expect(SuiteSchema.parse(withCase({ expectedCalls: [] })).cases[0].expectedCalls).toEqual([]);
    const calls = Array.from({ length: 17 }, () => ({ name: 'a' }));
    expect(SuiteSchema.safeParse(withCase({ expectedCalls: calls })).success).toBe(false);
    expect(SuiteSchema.safeParse(withCase({ expectedCalls: [{ name: '' }] })).success).toBe(false);
  });

  it('accepts toolResults with any JSON result and optional arguments', () => {
    const r = SuiteSchema.parse(
      withCase({
        toolResults: [
          { name: 'a', arguments: { id: 1 }, result: { ok: true } },
          { name: 'b', result: 'plain text' },
          { name: 'c', result: null },
        ],
        maxSteps: 3,
      }),
    );
    expect(r.cases[0].toolResults).toEqual([
      { name: 'a', arguments: { id: 1 }, result: { ok: true } },
      { name: 'b', result: 'plain text' },
      { name: 'c', result: null },
    ]);
    expect(r.cases[0].maxSteps).toBe(3);
  });

  it('rejects empty, oversized and malformed toolResults', () => {
    const entry = { name: 'a', result: 1 };
    expect(SuiteSchema.safeParse(withCase({ toolResults: [] })).success).toBe(false);
    expect(
      SuiteSchema.safeParse(withCase({ toolResults: Array.from({ length: 33 }, () => entry) })).success,
    ).toBe(false);
    expect(
      SuiteSchema.safeParse(withCase({ toolResults: Array.from({ length: 32 }, () => entry) })).success,
    ).toBe(true);
    expect(SuiteSchema.safeParse(withCase({ toolResults: [{ name: '', result: 1 }] })).success).toBe(false);
    expect(SuiteSchema.safeParse(withCase({ toolResults: [{ name: 'a' }] })).success).toBe(false);
    expect(
      SuiteSchema.safeParse(withCase({ toolResults: [{ name: 'a', arguments: 'x', result: 1 }] })).success,
    ).toBe(false);
  });

  it('bounds maxSteps to integers from 1 to 10 and leaves it undefined by default', () => {
    const tr = [{ name: 'a', result: 1 }];
    expect(SuiteSchema.parse(withCase({ toolResults: tr })).cases[0].maxSteps).toBeUndefined();
    for (const maxSteps of [1, 10]) {
      expect(SuiteSchema.safeParse(withCase({ toolResults: tr, maxSteps })).success).toBe(true);
    }
    for (const maxSteps of [0, 11, 2.5]) {
      expect(SuiteSchema.safeParse(withCase({ toolResults: tr, maxSteps })).success).toBe(false);
    }
  });
});
