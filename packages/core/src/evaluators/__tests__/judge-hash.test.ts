import { describe, it, expect } from 'vitest';

import type { ProviderAdapter } from '../../providers/base.js';
import { computeJudgeHash } from '../../engine/baseline.js';
import { hasLLMJudge, judgeHashForProvider } from '../judge-hash.js';
import { DEFAULT_JUDGE_PROMPT_TEMPLATE } from '../llm-judge.js';

function fakeProvider(name: string): ProviderAdapter {
  return {
    name,
    complete: async () => ({
      text: '',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      model: 'm',
      latencyMs: 0,
    }),
  };
}

describe('hasLLMJudge', () => {
  it('returns false for undefined or empty specs', () => {
    expect(hasLLMJudge(undefined)).toBe(false);
    expect(hasLLMJudge([])).toBe(false);
  });

  it('detects llm-judge by string spec', () => {
    expect(hasLLMJudge(['exact-match', 'llm-judge'])).toBe(true);
  });

  it('detects llm-judge by object spec', () => {
    expect(hasLLMJudge([{ name: 'llm-judge', weight: 0.5 }])).toBe(true);
  });

  it('returns false when llm-judge absent', () => {
    expect(hasLLMJudge(['exact-match', { name: 'json-schema' }])).toBe(false);
  });
});

describe('judgeHashForProvider', () => {
  it('is deterministic for the same provider across calls', () => {
    const p = fakeProvider('anthropic/claude-sonnet-4-5');
    const h1 = judgeHashForProvider({ provider: p });
    const h2 = judgeHashForProvider({ provider: p });
    expect(h1).toBe(h2);
  });

  it('differs across models', () => {
    const a = fakeProvider('anthropic/claude-sonnet-4-5');
    const b = fakeProvider('anthropic/claude-haiku-4-5');
    expect(judgeHashForProvider({ provider: a })).not.toBe(
      judgeHashForProvider({ provider: b }),
    );
  });

  it('differs across backends for the same model', () => {
    const a = fakeProvider('anthropic/claude-sonnet-4-5');
    const b = fakeProvider('bedrock/claude-sonnet-4-5');
    expect(judgeHashForProvider({ provider: a })).not.toBe(
      judgeHashForProvider({ provider: b }),
    );
  });

  it('changes when the prompt template changes', () => {
    const p = fakeProvider('anthropic/claude-sonnet-4-5');
    const def = judgeHashForProvider({ provider: p });
    const alt = judgeHashForProvider({
      provider: p,
      promptTemplate: () => 'a totally different prompt',
    });
    expect(def).not.toBe(alt);
  });

  it('matches computeJudgeHash wired with the default template', () => {
    const p = fakeProvider('anthropic/claude-sonnet-4-5');
    const expected = computeJudgeHash(
      'anthropic',
      'claude-sonnet-4-5',
      DEFAULT_JUDGE_PROMPT_TEMPLATE('drift_fence'),
    );
    expect(judgeHashForProvider({ provider: p })).toBe(expected);
  });
});
