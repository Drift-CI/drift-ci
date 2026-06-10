import { describe, it, expect, beforeEach } from 'vitest';
import {
  cosineSimilarity,
  EmbeddingEvaluator,
  setEmbedderForTesting,
  type Embedder,
} from '../embedding.js';

function fakeEmbedder(map: Record<string, number[]>): Embedder {
  return async (text) => {
    const v = map[text];
    if (!v) throw new Error(`fake embedder: no vector for "${text}"`);
    return { data: v };
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('returns -1 for opposing vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(-1);
  });

  it('throws on length mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(/length mismatch/);
  });

  it('returns 0 for a zero-magnitude vector', () => {
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
  });
});

describe('EmbeddingEvaluator', () => {
  beforeEach(() => {
    setEmbedderForTesting(null);
  });

  it('requires expected output', async () => {
    const ev = new EmbeddingEvaluator(async () =>
      fakeEmbedder({ a: [1, 0], b: [1, 0] }),
    );
    await expect(ev.evaluate({ input: 'x', output: 'a' })).rejects.toThrow(
      /requires expected output/,
    );
  });

  it('returns 1.0 for identical strings (via fake embedder)', async () => {
    const factory = async () =>
      fakeEmbedder({ 'hello world': [1, 0, 0], 'hello world ': [1, 0, 0] });
    const ev = new EmbeddingEvaluator(factory);
    const res = await ev.evaluate({
      input: 'q',
      output: 'hello world',
      expected: 'hello world',
    });
    expect(res.score).toBeCloseTo(1, 5);
    expect(res.reason).toMatch(/Cosine similarity/);
  });

  it('clamps negative similarity to 0', async () => {
    const factory = async () => fakeEmbedder({ a: [1, 0], b: [-1, 0] });
    const ev = new EmbeddingEvaluator(factory);
    const res = await ev.evaluate({ input: 'q', output: 'a', expected: 'b' });
    expect(res.score).toBe(0);
  });

  it('caches the embedder factory across calls', async () => {
    let factoryCalls = 0;
    const factory = async () => {
      factoryCalls += 1;
      return fakeEmbedder({ a: [1, 0], b: [1, 0] });
    };
    const ev = new EmbeddingEvaluator(factory);
    await ev.evaluate({ input: 'q', output: 'a', expected: 'b' });
    await ev.evaluate({ input: 'q', output: 'a', expected: 'b' });
    expect(factoryCalls).toBe(1);
  });
});
