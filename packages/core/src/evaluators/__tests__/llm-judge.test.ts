import { describe, it, expect, vi } from 'vitest';

import type { ProviderAdapter } from '../../providers/base.js';
import { LLMJudgeEvaluator } from '../llm-judge.js';

function judgeProvider(response: string): ProviderAdapter & {
  complete: ReturnType<typeof vi.fn>;
} {
  const complete = vi.fn().mockResolvedValue({
    text: response,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: 'judge-model',
    latencyMs: 1,
  });
  return { name: 'judge/model-x', complete };
}

describe('LLMJudgeEvaluator', () => {
  it('parses a valid JSON response and clamps score to [0,1]', async () => {
    const provider = judgeProvider('{"score": 0.75, "reason": "ok"}');
    const ev = new LLMJudgeEvaluator({ judgeProvider: provider });
    const res = await ev.evaluate({
      input: 'q',
      output: 'a',
      expected: 'ref',
    });
    expect(res.score).toBeCloseTo(0.75);
    expect(res.reason).toBe('ok');
  });

  it('clamps out-of-range scores', async () => {
    const provider = judgeProvider('{"score": 1.5}');
    const ev = new LLMJudgeEvaluator({ judgeProvider: provider });
    const hi = await ev.evaluate({ input: 'q', output: 'a' });
    expect(hi.score).toBe(1);

    const provider2 = judgeProvider('{"score": -0.5}');
    const ev2 = new LLMJudgeEvaluator({ judgeProvider: provider2 });
    const lo = await ev2.evaluate({ input: 'q', output: 'a' });
    expect(lo.score).toBe(0);
  });

  it('falls back to score 0 with reason "judge-unparseable" on non-JSON', async () => {
    const provider = judgeProvider('this is not json');
    const ev = new LLMJudgeEvaluator({ judgeProvider: provider });
    const res = await ev.evaluate({ input: 'q', output: 'a' });
    expect(res.score).toBe(0);
    expect(res.reason).toBe('judge-unparseable');
  });

  it('falls back to score 0 on shape-invalid JSON', async () => {
    const provider = judgeProvider('{"notScore": 1}');
    const ev = new LLMJudgeEvaluator({ judgeProvider: provider });
    const res = await ev.evaluate({ input: 'q', output: 'a' });
    expect(res.score).toBe(0);
    expect(res.reason).toBe('judge-shape-invalid');
  });

  it('fences user fields with a per-call random marker and does not leak field tags into prompt outside fences', async () => {
    const provider = judgeProvider('{"score": 1}');
    const seen: string[] = [];
    provider.complete.mockImplementation(async (userMsg: string, system: string) => {
      seen.push(userMsg, system);
      return {
        text: '{"score": 1}',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'm',
        latencyMs: 1,
      };
    });
    const ev = new LLMJudgeEvaluator({ judgeProvider: provider });
    await ev.evaluate({
      input: 'who is Ada?',
      output: 'Ada Lovelace',
      expected: 'Ada',
      criteria: 'factual accuracy',
    });
    const [userMsg, system] = seen;
    const fenceMatch = userMsg.match(/<(drift_[a-f0-9]{12})>/);
    expect(fenceMatch).not.toBeNull();
    const fence = fenceMatch![1];
    expect(userMsg).toContain(`<${fence}>question: who is Ada?</${fence}>`);
    expect(userMsg).toContain(`<${fence}>candidate: Ada Lovelace</${fence}>`);
    expect(system).toContain(`<${fence}>`);
  });

  it('generates a different fence on each call', async () => {
    const provider = judgeProvider('{"score": 1}');
    const fences: string[] = [];
    provider.complete.mockImplementation(async (userMsg: string) => {
      fences.push(userMsg.match(/drift_[a-f0-9]{12}/)![0]);
      return {
        text: '{"score": 1}',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        model: 'm',
        latencyMs: 1,
      };
    });
    const ev = new LLMJudgeEvaluator({ judgeProvider: provider });
    await ev.evaluate({ input: 'x', output: 'y' });
    await ev.evaluate({ input: 'x', output: 'y' });
    expect(fences[0]).not.toBe(fences[1]);
  });

  it('warns when judge and test providers are the same (self-bias)', () => {
    const provider = judgeProvider('{"score": 1}');
    const warn = vi.fn();
    new LLMJudgeEvaluator({
      judgeProvider: provider,
      testProviderName: 'judge/model-x',
      warn,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/self-evaluation is biased/i);
  });

  it('does not warn when testProviderName differs from judgeProvider.name', () => {
    const provider = judgeProvider('{"score": 1}');
    const warn = vi.fn();
    new LLMJudgeEvaluator({
      judgeProvider: provider,
      testProviderName: 'anthropic/claude-sonnet-4-5',
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not warn when allowSelfBias is true', () => {
    const provider = judgeProvider('{"score": 1}');
    const warn = vi.fn();
    new LLMJudgeEvaluator({
      judgeProvider: provider,
      testProviderName: 'judge/model-x',
      allowSelfBias: true,
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
