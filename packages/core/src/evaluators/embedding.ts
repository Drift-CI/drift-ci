import type { EvalInput, EvalResult, Evaluator } from './base.js';

const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

export interface EmbedOptions {
  pooling: 'mean' | 'cls' | 'none';
  normalize: boolean;
}

export interface EmbeddingTensor {
  data: Float32Array | number[];
}

export type Embedder = (
  text: string,
  options: EmbedOptions,
) => Promise<EmbeddingTensor>;

let cachedEmbedder: Promise<Embedder> | null = null;

async function loadDefaultEmbedder(): Promise<Embedder> {
  const mod: typeof import('@xenova/transformers') = await import(
    '@xenova/transformers'
  );
  mod.env.allowLocalModels = false;
  const pipe = await mod.pipeline('feature-extraction', EMBEDDING_MODEL);
  return (text, options) =>
    pipe(text, options) as unknown as Promise<EmbeddingTensor>;
}

export function setEmbedderForTesting(embedder: Embedder | null): void {
  cachedEmbedder = embedder ? Promise.resolve(embedder) : null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `cosine-similarity: vector length mismatch (${a.length} vs ${b.length})`,
    );
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export class EmbeddingEvaluator implements Evaluator {
  name = 'cosine-similarity';

  constructor(private embedderFactory: () => Promise<Embedder> = loadDefaultEmbedder) {}

  async evaluate({ output, expected }: EvalInput): Promise<EvalResult> {
    if (expected === undefined) {
      throw new Error('cosine-similarity requires expected output');
    }

    if (!cachedEmbedder) cachedEmbedder = this.embedderFactory();
    const embed = await cachedEmbedder;

    const [outEmb, expEmb] = await Promise.all([
      embed(output, { pooling: 'mean', normalize: true }),
      embed(expected, { pooling: 'mean', normalize: true }),
    ]);

    const score = cosineSimilarity(
      Array.from(outEmb.data),
      Array.from(expEmb.data),
    );
    const clamped = Math.max(0, Math.min(1, score));
    return {
      score: clamped,
      reason: `Cosine similarity: ${score.toFixed(4)}`,
    };
  }
}
