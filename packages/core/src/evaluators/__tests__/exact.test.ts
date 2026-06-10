import { describe, it, expect } from 'vitest';
import { ExactMatchEvaluator, RegexMatchEvaluator } from '../exact.js';
import { EvaluatorChain } from '../composite.js';
import { createEvaluatorChain } from '../factory.js';

const baseInput = { input: 'q', output: '', expected: '' };

describe('ExactMatchEvaluator', () => {
  const ev = new ExactMatchEvaluator();

  it('scores 1.0 for exact match (case + whitespace normalised)', async () => {
    const r = await ev.evaluate({
      ...baseInput,
      output: '  Hello  ',
      expected: 'hello',
    });
    expect(r.score).toBe(1);
  });

  it('scores 0.0 for non-match', async () => {
    const r = await ev.evaluate({
      ...baseInput,
      output: 'foo',
      expected: 'bar',
    });
    expect(r.score).toBe(0);
  });

  it('throws when expected is missing', async () => {
    await expect(
      ev.evaluate({ input: 'q', output: 'anything' }),
    ).rejects.toThrow('exact-match requires expected output');
  });
});

describe('RegexMatchEvaluator', () => {
  it('scores 1.0 when the pattern matches', async () => {
    const r = await new RegexMatchEvaluator('hello').evaluate({
      ...baseInput,
      output: 'well, HELLO there',
    });
    expect(r.score).toBe(1);
  });

  it('scores 0.0 when the pattern does not match', async () => {
    const r = await new RegexMatchEvaluator('^hello$').evaluate({
      ...baseInput,
      output: 'prefix hello',
    });
    expect(r.score).toBe(0);
  });
});

describe('EvaluatorChain', () => {
  it('rejects empty evaluator list', () => {
    expect(() => new EvaluatorChain([])).toThrow('at least one evaluator');
  });

  it('rejects weights that do not sum to 1.0', () => {
    expect(
      () =>
        new EvaluatorChain([
          { evaluator: new ExactMatchEvaluator(), weight: 0.3 },
          { evaluator: new ExactMatchEvaluator(), weight: 0.3 },
        ]),
    ).toThrow('Evaluator weights must sum to 1.0');
  });

  it('averages scores by weight when weights sum to 1.0', async () => {
    const chain = new EvaluatorChain([
      { evaluator: new ExactMatchEvaluator(), weight: 0.5 },
      { evaluator: new RegexMatchEvaluator('abc'), weight: 0.5 },
    ]);
    const r = await chain.evaluate({
      input: 'q',
      output: 'xyz contains abc',
      expected: 'exact',
    });
    expect(r.score).toBe(0.5);
  });
});

describe('createEvaluatorChain factory', () => {
  const ctx = {
    testProvider: { name: 'mock/test-model', complete: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, model: 'm', latencyMs: 0 }) },
  } as const;

  it('assigns equal implicit weights when none given', async () => {
    const chain = createEvaluatorChain(['exact-match', 'exact-match'], ctx);
    const r = await chain.evaluate({
      input: 'q',
      output: 'hi',
      expected: 'hi',
    });
    expect(r.score).toBe(1);
  });

  it('rejects an empty spec list', () => {
    expect(() => createEvaluatorChain([], ctx)).toThrow(
      'At least one evaluator',
    );
  });

  it('rejects unknown evaluator names', () => {
    expect(() =>
      createEvaluatorChain(['nonsense'], ctx),
    ).toThrow('Unknown evaluator');
  });
});
