import { describe, it, expect, vi } from 'vitest';

import type { ProviderAdapter } from '../../providers/base.js';
import { FaithfulnessEvaluator } from '../faithfulness.js';
import { createEvaluatorChain } from '../factory.js';

function judgeProvider(
  response: string,
  name = 'judge/model-x',
): ProviderAdapter & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn().mockResolvedValue({
    text: response,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    model: 'judge-model',
    latencyMs: 1,
  });
  return { name, complete };
}

const claims = (...flags: boolean[]) =>
  JSON.stringify({
    claims: flags.map((s, i) => ({ claim: `claim ${i + 1}`, supported: s })),
  });

const base = { input: 'q', output: 'a', context: ['p1', 'p2'] };

describe('FaithfulnessEvaluator scoring', () => {
  it('scores 1 when all claims are supported', async () => {
    const ev = new FaithfulnessEvaluator({
      judgeProvider: judgeProvider(claims(true, true, true)),
    });
    const res = await ev.evaluate(base);
    expect(res.score).toBe(1);
    expect(res.reason).toBe('all 3 claims supported');
  });

  it('scores the supported fraction and lists unsupported claims', async () => {
    const ev = new FaithfulnessEvaluator({
      judgeProvider: judgeProvider(claims(true, true, false, true)),
    });
    const res = await ev.evaluate(base);
    expect(res.score).toBe(0.75);
    expect(res.reason).toContain('1 of 4 claims unsupported: "claim 3"');
    expect((res.metadata as { unsupported: string[] }).unsupported).toHaveLength(1);
  });

  it('truncates long claim lists and reasons', async () => {
    const long = 'x'.repeat(200);
    const text = JSON.stringify({
      claims: Array.from({ length: 5 }, () => ({ claim: long, supported: false })),
    });
    const ev = new FaithfulnessEvaluator({ judgeProvider: judgeProvider(text) });
    const res = await ev.evaluate(base);
    expect(res.score).toBe(0);
    expect((res.reason ?? '').length).toBeLessThanOrEqual(200);
    const listed = (res.reason ?? '').match(/"[^"]*"/g) ?? [];
    expect(listed.length).toBeLessThanOrEqual(3);
    listed.forEach((l) => expect(l.length - 2).toBeLessThanOrEqual(80));
  });

  it('scores 1 when there are no claims', async () => {
    const ev = new FaithfulnessEvaluator({
      judgeProvider: judgeProvider('{"claims": []}'),
    });
    const res = await ev.evaluate(base);
    expect(res.score).toBe(1);
    expect(res.reason).toBe('no factual claims');
  });
});

describe('FaithfulnessEvaluator bad judge replies', () => {
  it('non-JSON gives judge-unparseable', async () => {
    const ev = new FaithfulnessEvaluator({ judgeProvider: judgeProvider('nope') });
    expect(await ev.evaluate(base)).toMatchObject({
      score: 0,
      reason: 'judge-unparseable',
    });
  });

  it('wrong shapes give judge-shape-invalid', async () => {
    for (const text of ['{"score":1}', '{"claims":[{"claim":1,"supported":true}]}']) {
      const ev = new FaithfulnessEvaluator({ judgeProvider: judgeProvider(text) });
      expect(await ev.evaluate(base)).toMatchObject({
        score: 0,
        reason: 'judge-shape-invalid',
      });
    }
  });

  it('parses a ```json fenced reply', async () => {
    const ev = new FaithfulnessEvaluator({
      judgeProvider: judgeProvider('```json\n' + claims(true) + '\n```'),
    });
    expect((await ev.evaluate(base)).score).toBe(1);
  });
});

describe('FaithfulnessEvaluator call', () => {
  it('fences question, numbered context and candidate; uses temperature 0', async () => {
    const provider = judgeProvider(claims(true));
    const ev = new FaithfulnessEvaluator({
      judgeProvider: provider,
      fenceFactory: () => 'F',
    });
    await ev.evaluate({
      input: 'the question',
      output: 'the answer',
      context: ['p1', 'p2'],
    });
    const [user, system, opts] = provider.complete.mock.calls[0];
    expect(user).toContain('<F>question: the question</F>');
    expect(user).toContain('<F>context: [1] p1\n[2] p2</F>');
    expect(user).toContain('<F>candidate: the answer</F>');
    expect(system).toContain('`<F>`');
    expect(opts).toEqual({ temperature: 0, maxTokens: 1000 });
  });

  it('throws without context', async () => {
    const ev = new FaithfulnessEvaluator({ judgeProvider: judgeProvider(claims(true)) });
    await expect(ev.evaluate({ input: 'q', output: 'a' })).rejects.toThrow(
      'requires context',
    );
    await expect(
      ev.evaluate({ input: 'q', output: 'a', context: [] }),
    ).rejects.toThrow('requires context');
  });
});

describe('FaithfulnessEvaluator self-bias warning', () => {
  it('warns when judge equals test provider', () => {
    const warn = vi.fn();
    new FaithfulnessEvaluator({
      judgeProvider: judgeProvider('', 'a/m'),
      testProviderName: 'a/m',
      warn,
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('allowSelfBias silences it', () => {
    const warn = vi.fn();
    new FaithfulnessEvaluator({
      judgeProvider: judgeProvider('', 'a/m'),
      testProviderName: 'a/m',
      allowSelfBias: true,
      warn,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('createEvaluatorChain faithfulness', () => {
  it('builds for a case with context', () => {
    expect(() =>
      createEvaluatorChain(['faithfulness'], {
        testProvider: judgeProvider('', 'test/x'),
        judgeProvider: judgeProvider('', 'judge/y'),
        case: { context: ['p'] },
      }),
    ).not.toThrow();
  });

  it('throws for a case without context', () => {
    expect(() =>
      createEvaluatorChain(['faithfulness'], {
        testProvider: judgeProvider('', 'test/x'),
        judgeProvider: judgeProvider('', 'judge/y'),
        case: {},
      }),
    ).toThrow('requires a `context` field');
  });
});
