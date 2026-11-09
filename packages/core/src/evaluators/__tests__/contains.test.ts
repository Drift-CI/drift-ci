import { describe, expect, it } from 'vitest';
import { ContainsEvaluator } from '../contains.js';
import { createEvaluatorChain } from '../factory.js';

const baseInput = { input: 'q', output: '' };

describe('ContainsEvaluator', () => {
  it('scores 1 when every required substring appears case-insensitively', async () => {
    const result = await new ContainsEvaluator([
      'refund',
      '5 BUSINESS days',
    ]).evaluate({
      ...baseInput,
      output: 'Your REFUND should arrive within 5 business days.',
    });

    expect(result).toEqual({
      score: 1,
      reason: 'All required text found',
    });
  });

  it('scores 0 and reports every missing substring', async () => {
    const result = await new ContainsEvaluator([
      'refund',
      '5 business days',
      'email',
    ]).evaluate({
      ...baseInput,
      output: 'Your refund has been approved.',
    });

    expect(result).toEqual({
      score: 0,
      reason: 'Missing required text: 5 business days, email',
    });
  });

  it('rejects an empty required-substring list', () => {
    expect(() => new ContainsEvaluator([])).toThrow(
      'requires a non-empty `contains` field',
    );
  });
});

describe('createEvaluatorChain — contains', () => {
  const testProvider = {
    name: 'mock/test-model',
    complete: async () => ({
      text: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      model: 'm',
      latencyMs: 0,
    }),
  } as const;

  it('uses the test case contains field', async () => {
    const chain = createEvaluatorChain(['contains'], {
      testProvider,
      case: { contains: ['ticket-', 'resolved'] },
    });

    const result = await chain.evaluate({
      ...baseInput,
      output: 'TICKET-123 has been resolved.',
    });

    expect(result.score).toBe(1);
  });

  it('rejects contains when the case field is missing', () => {
    expect(() =>
      createEvaluatorChain(['contains'], { testProvider, case: {} }),
    ).toThrow('requires a non-empty `contains` field');
  });
});
