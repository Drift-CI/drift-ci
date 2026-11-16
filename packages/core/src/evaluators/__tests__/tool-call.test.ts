import { describe, it, expect } from 'vitest';
import { ToolCallEvaluator } from '../tool-call.js';
import { createEvaluatorChain } from '../factory.js';
import { MockProvider } from '../../providers/mock.js';

const call = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: args });
const base = { input: 'q', output: '' };
const run = (expected: { name: string; arguments: Record<string, unknown> }[], toolCalls?: ReturnType<typeof call>[]) =>
  new ToolCallEvaluator(expected).evaluate({ ...base, toolCalls });

describe('ToolCallEvaluator', () => {
  it('scores 1 when every call matches', async () => {
    const res = await run([call('a', { x: 1 })], [call('a', { x: 1 })]);
    expect(res.score).toBe(1);
    expect(res.reason).toBe('all 1 calls matched');
    expect(res.metadata).toEqual({ expected: 1, actual: [call('a', { x: 1 })] });
  });

  it('gives partial credit for a wrong argument value', async () => {
    const res = await run([call('a', { x: 1, y: 'p' })], [call('a', { x: 1, y: 'q' })]);
    expect(res.score).toBe(0.5);
    expect(res.reason).toBe('a.y: expected "p", got "q"');
  });

  it('reports a missing argument as missing', async () => {
    const res = await run([call('a', { x: 1 })], [call('a', {})]);
    expect(res.score).toBe(0);
    expect(res.reason).toBe('a.x: expected 1, got missing');
  });

  it('ignores unlisted extra arguments', async () => {
    const res = await run([call('a', { x: 1 })], [call('a', { x: 1, z: 9 })]);
    expect(res.score).toBe(1);
  });

  it('scores a call with no listed arguments as 1 on name match', async () => {
    expect((await run([call('a')], [call('a', { z: 1 })])).score).toBe(1);
  });

  it('scores a missing call as 0', async () => {
    const res = await run([call('a')], []);
    expect(res.score).toBe(0);
    expect(res.reason).toBe('missing call: a');
  });

  it('penalises an extra call through the denominator', async () => {
    const res = await run([call('a')], [call('a'), call('b')]);
    expect(res.score).toBe(0.5);
    expect(res.reason).toBe('unexpected call: b');
  });

  it('ignores order across different names', async () => {
    const res = await run([call('a', { x: 1 }), call('b', { y: 2 })], [call('b', { y: 2 }), call('a', { x: 1 })]);
    expect(res.score).toBe(1);
  });

  it('matches two same-name calls to their best argument scores', async () => {
    const res = await run(
      [call('a', { id: '1' }), call('a', { id: '2' })],
      [call('a', { id: '2' }), call('a', { id: '1' })],
    );
    expect(res.score).toBe(1);
  });

  it('breaks ties toward the earliest actual call', async () => {
    const res = await run([call('a', { id: '1' })], [call('a', { id: '1' }), call('a', { id: '1' })]);
    expect(res.score).toBe(0.5);
  });

  it('scores 1 for expected [] with no calls', async () => {
    expect((await run([], [])).score).toBe(1);
  });

  it('scores 0 for expected [] with calls', async () => {
    const res = await run([], [call('a'), call('b')]);
    expect(res.score).toBe(0);
    expect(res.reason).toBe('expected no tool call, got: a, b');
  });

  it('throws when toolCalls is undefined', async () => {
    await expect(run([call('a')], undefined)).rejects.toThrow(
      'tool-call evaluator: the provider returned no tool-call data (does this provider support tools?)',
    );
  });

  it('lists at most 3 problems joined by "; "', async () => {
    const res = await run([call('a'), call('b'), call('c'), call('d')], []);
    expect(res.reason).toBe('missing call: a; missing call: b; missing call: c');
  });

  it('caps the reason at 200 characters and values at 40', async () => {
    const long = 'x'.repeat(100);
    const res = await run(
      [call('a', { p: long, q: long, r: long })],
      [call('a', { p: 'n', q: 'n', r: 'n' })],
    );
    expect(res.reason!.length).toBeLessThanOrEqual(200);
    expect(res.reason).toContain(`"${'x'.repeat(38)}…`);
  });

  it('caps actual calls in metadata at 16', async () => {
    const many = Array.from({ length: 20 }, () => call('a'));
    const res = await run([], many);
    expect((res.metadata as { actual: unknown[] }).actual).toHaveLength(16);
  });

  it('compares strings after trimming', async () => {
    expect((await run([call('a', { s: ' hi ' })], [call('a', { s: 'hi' })])).score).toBe(1);
  });

  it('compares numbers and booleans exactly', async () => {
    expect((await run([call('a', { n: 1 })], [call('a', { n: '1' })])).score).toBe(0);
    expect((await run([call('a', { b: true })], [call('a', { b: true })])).score).toBe(1);
  });

  it('compares nested objects and arrays deeply', async () => {
    const exp = { o: { k: [' a ', { z: 1 }] } };
    expect((await run([call('t', exp)], [call('t', { o: { k: ['a', { z: 1 }] } })])).score).toBe(1);
    expect((await run([call('t', exp)], [call('t', { o: { k: ['a', { z: 2 }] } })])).score).toBe(0);
    expect((await run([call('t', { o: { k: [1] } })], [call('t', { o: { k: [1], extra: 1 } })])).score).toBe(0);
  });
});

describe('tool-call in the factory', () => {
  const ctx = { testProvider: new MockProvider({ defaultResponse: 'x' }) };
  const tools = [{ name: 'a', parameters: { type: 'object', properties: {} } }];

  it('builds the evaluator from the case', async () => {
    const chain = createEvaluatorChain(['tool-call'], {
      ...ctx,
      case: { expectedCalls: [call('a')], tools },
    });
    const res = await chain.evaluate({ ...base, toolCalls: [call('a')] });
    expect(res.score).toBe(1);
  });

  it('throws without expectedCalls', () => {
    expect(() => createEvaluatorChain(['tool-call'], { ...ctx, case: { tools } })).toThrow(
      'tool-call evaluator requires `expectedCalls` and at least one tool on the test case.',
    );
  });

  it('throws without tools', () => {
    expect(() =>
      createEvaluatorChain(['tool-call'], { ...ctx, case: { expectedCalls: [call('a')] } }),
    ).toThrow('requires `expectedCalls` and at least one tool');
  });
});
