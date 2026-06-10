import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REFUSAL_PATTERNS,
  RefusalDetectionEvaluator,
} from '../refusal.js';

function ev(output: string, init?: ConstructorParameters<typeof RefusalDetectionEvaluator>[0]) {
  return new RefusalDetectionEvaluator(init).evaluate({
    input: 'irrelevant',
    output,
  });
}

describe('RefusalDetectionEvaluator', () => {
  it('exposes the "refusal-detection" name', () => {
    expect(new RefusalDetectionEvaluator().name).toBe('refusal-detection');
  });

  it('scores 1.0 on a normal answer', async () => {
    const r = await ev('The capital of France is Paris.');
    expect(r.score).toBe(1);
    expect(r.reason).toMatch(/No refusal/);
  });

  it('scores 0 when the output opens with "I can\'t"', async () => {
    const r = await ev("I can't help with that request.");
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/Refusal pattern matched/);
    expect(r.metadata?.matchedText).toMatch(/I can't/);
  });

  it('catches "As an AI language model" boilerplate', async () => {
    const r = await ev('As an AI language model, I cannot provide financial advice.');
    expect(r.score).toBe(0);
  });

  it('catches "I apologize, but I" openings', async () => {
    const r = await ev('I apologize, but I am not able to share that.');
    expect(r.score).toBe(0);
  });

  it('is case-insensitive by default', async () => {
    const r = await ev('AS AN AI, I CANNOT HELP WITH THAT.');
    expect(r.score).toBe(0);
  });

  it('respects caseSensitive: true', async () => {
    const strict = await ev('as an ai, i will not.', { caseSensitive: true });
    expect(strict.score).toBe(1);
    const matched = await ev("I can't help.", { caseSensitive: true });
    expect(matched.score).toBe(0);
  });

  it('only looks at the opening 400 chars so buried phrases are not refusals', async () => {
    const prefix = 'Here is the answer you asked for: '.repeat(20);
    const r = await ev(`${prefix} by the way, I cannot do anything else.`);
    expect(r.score).toBe(1);
  });

  it('accepts additional custom patterns alongside defaults', async () => {
    const r = await ev('This is off-limits for me.', {
      patterns: ['off-limits for me'],
    });
    expect(r.score).toBe(0);
    expect(r.metadata?.matchedPattern).toBe('off-limits for me');
  });

  it('replaceDefaults disables the built-in list', async () => {
    const noMatch = await ev("I can't help with that.", {
      patterns: ['nope-never'],
      replaceDefaults: true,
    });
    expect(noMatch.score).toBe(1);
    const match = await ev('nope-never.', {
      patterns: ['nope-never'],
      replaceDefaults: true,
    });
    expect(match.score).toBe(0);
  });

  it('throws when replaceDefaults=true with no custom patterns', () => {
    expect(
      () =>
        new RefusalDetectionEvaluator({ replaceDefaults: true, patterns: [] }),
    ).toThrowError(/at least one pattern/);
  });

  it('truncates long matched text in the reason field', async () => {
    const long = 'I cannot help with ' + 'x'.repeat(200);
    const r = await ev(long);
    expect(r.score).toBe(0);
    expect(r.reason!.length).toBeLessThan(160);
  });

  it('DEFAULT_REFUSAL_PATTERNS is a non-empty frozen list', () => {
    expect(Object.isFrozen(DEFAULT_REFUSAL_PATTERNS)).toBe(true);
    expect(DEFAULT_REFUSAL_PATTERNS.length).toBeGreaterThan(5);
  });
});
