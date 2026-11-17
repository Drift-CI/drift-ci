import { describe, it, expect, vi } from 'vitest';
import { runToolLoop } from '../tool-loop.js';
import { Runner } from '../runner.js';
import { MockProvider, type MockResult } from '../../providers/mock.js';
import type { CompletionInput, ConversationTurn } from '../../providers/base.js';
import { EvaluatorChain } from '../../evaluators/composite.js';
import { createEvaluatorChain } from '../../evaluators/factory.js';
import type { EvalInput } from '../../evaluators/base.js';
import { MemoryStorage } from '../../storage/memory.js';
import type { Suite, TestCase } from '../../types/index.js';

const tools = [
  { name: 'get_order', parameters: { type: 'object', properties: {} } },
  { name: 'refund_order', parameters: { type: 'object', properties: {} } },
];

function refundCase(extra: Partial<TestCase> = {}): TestCase {
  return {
    id: 'refund',
    input: 'Refund order ORD-123',
    tools,
    toolResults: [
      { name: 'get_order', arguments: { order_id: 'ORD-123' }, result: { status: 'delivered', total: 42 } },
      { name: 'refund_order', result: { ok: true } },
    ],
    ...extra,
  };
}

/** Mock provider replying from a script, one entry per step; records each step's input. */
function scripted(script: (MockResult | Error)[]) {
  const inputs: CompletionInput[] = [];
  let i = 0;
  const provider = new MockProvider({
    responder: (input) => {
      inputs.push(structuredClone(input));
      return script[i++] ?? 'done';
    },
  });
  return { provider, inputs };
}

const call = (name: string, args: Record<string, unknown>) => ({ name, arguments: args });

describe('runToolLoop', () => {
  it('runs a 2-step happy path with a transcript, every call and summed usage', async () => {
    const { provider, inputs } = scripted([
      { text: 'Looking it up.', toolCalls: [call('get_order', { order_id: 'ORD-123' })] },
      { text: '', toolCalls: [call('refund_order', { order_id: 'ORD-123' })] },
      { text: '  Refunded ORD-123.  ' },
    ]);
    const r = await runToolLoop(provider, refundCase(), { timeoutMs: 1000 });

    expect(r.steps).toBe(3);
    expect(r.stoppedAtStepLimit).toBe(false);
    expect(r.toolCalls).toEqual([
      { id: 'call_1', name: 'get_order', arguments: { order_id: 'ORD-123' } },
      { id: 'call_2', name: 'refund_order', arguments: { order_id: 'ORD-123' } },
    ]);
    expect(r.usage).toEqual({ inputTokens: 30, outputTokens: 30, totalTokens: 60 });
    expect(r.output).toBe(
      [
        'Looking it up.',
        '→ get_order {"order_id":"ORD-123"}',
        '← {"status":"delivered","total":42}',
        '→ refund_order {"order_id":"ORD-123"}',
        '← {"ok":true}',
        '',
        'Refunded ORD-123.',
      ].join('\n'),
    );

    expect(inputs[0]).toEqual([{ role: 'user', content: 'Refund order ORD-123' }]);
    expect(inputs[2]).toEqual([
      { role: 'user', content: 'Refund order ORD-123' },
      {
        role: 'assistant',
        content: 'Looking it up.',
        toolCalls: [{ id: 'call_1', name: 'get_order', arguments: { order_id: 'ORD-123' } }],
      },
      {
        role: 'tool',
        results: [{ callId: 'call_1', name: 'get_order', content: '{"status":"delivered","total":42}' }],
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_2', name: 'refund_order', arguments: { order_id: 'ORD-123' } }],
      },
      { role: 'tool', results: [{ callId: 'call_2', name: 'refund_order', content: '{"ok":true}' }] },
    ] satisfies ConversationTurn[]);
  });

  it('sends the case options to every step', async () => {
    const opts: unknown[] = [];
    let i = 0;
    const provider = new MockProvider({
      responder: (_in, system, o) => {
        opts.push({ system, ...o });
        return i++ === 0 ? { text: '', toolCalls: [call('refund_order', {})] } : 'ok';
      },
    });
    await runToolLoop(provider, refundCase({ systemPrompt: 'be brief', maxTokens: 50 }), { timeoutMs: 1000 });
    expect(opts).toHaveLength(2);
    for (const o of opts) expect(o).toEqual({ system: 'be brief', temperature: 0, maxTokens: 50, tools });
  });

  it('answers an unscripted call with an error result and keeps going', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [call('get_order', { order_id: 'ORD-999' })] },
      'Sorry, I could not find it.',
    ]);
    const r = await runToolLoop(provider, refundCase(), { timeoutMs: 1000 });
    const last = inputs[1] as ConversationTurn[];
    expect(last[2]).toEqual({
      role: 'tool',
      results: [
        {
          callId: 'call_1',
          name: 'get_order',
          content: 'no result scripted for get_order with these arguments',
          isError: true,
        },
      ],
    });
    expect(r.steps).toBe(2);
    expect(r.output).toBe(
      [
        '→ get_order {"order_id":"ORD-999"}',
        '← no result scripted for get_order with these arguments',
        '',
        'Sorry, I could not find it.',
      ].join('\n'),
    );
  });

  it('picks the first entry whose listed arguments match, and sends strings as-is', async () => {
    const tc = refundCase({
      toolResults: [
        { name: 'get_order', arguments: { order_id: 'A' }, result: 'order A' },
        { name: 'get_order', arguments: { order_id: 'B' }, result: 'order B' },
        { name: 'get_order', result: 'any order' },
      ],
    });
    const { provider, inputs } = scripted([
      {
        text: '',
        toolCalls: [call('get_order', { order_id: 'B', verbose: true }), call('get_order', { order_id: 'C' })],
      },
      'done',
    ]);
    await runToolLoop(provider, tc, { timeoutMs: 1000 });
    expect((inputs[1] as ConversationTurn[])[2]).toEqual({
      role: 'tool',
      results: [
        { callId: 'call_1', name: 'get_order', content: 'order B' },
        { callId: 'call_2', name: 'get_order', content: 'any order' },
      ],
    });
  });

  it('echoes the provider ids and truncates long results in the transcript', async () => {
    const long = 'x'.repeat(500);
    const tc = refundCase({ toolResults: [{ name: 'get_order', result: long }] });
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [{ id: 'toolu_9', name: 'get_order', arguments: {} }] },
      'done',
    ]);
    const r = await runToolLoop(provider, tc, { timeoutMs: 1000 });
    expect((inputs[1] as ConversationTurn[])[2]).toEqual({
      role: 'tool',
      results: [{ callId: 'toolu_9', name: 'get_order', content: long }],
    });
    const resultLine = r.output.split('\n')[1];
    expect(resultLine).toBe(`← ${'x'.repeat(199)}…`);
  });

  it('truncates a result by code points, never splitting a surrogate pair', async () => {
    const tc = refundCase({ toolResults: [{ name: 'get_order', result: `${'x'.repeat(198)}😀yyy` }] });
    const { provider } = scripted([{ text: '', toolCalls: [call('get_order', {})] }, 'done']);
    const r = await runToolLoop(provider, tc, { timeoutMs: 1000 });
    expect(r.output.split('\n')[1]).toBe(`← ${'x'.repeat(198)}😀…`);
  });

  it('carries a call\'s providerMeta into the next step\'s assistant turn unchanged', async () => {
    const signed = { name: 'get_order', arguments: {}, providerMeta: { thoughtSignature: 'SIG123' } };
    const { provider, inputs } = scripted([{ text: '', toolCalls: [signed] }, 'done']);
    await runToolLoop(provider, refundCase(), { timeoutMs: 1000 });
    expect((inputs[1] as ConversationTurn[])[1]).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', ...signed }],
    });
  });

  it('stops at maxSteps and reports it', async () => {
    const provider = new MockProvider({
      responder: () => ({ text: 'again', toolCalls: [call('refund_order', {})] }),
    });
    const r = await runToolLoop(provider, refundCase({ maxSteps: 2 }), { timeoutMs: 1000 });
    expect(r.steps).toBe(2);
    expect(r.stoppedAtStepLimit).toBe(true);
    expect(r.toolCalls.map((c) => c.id)).toEqual(['call_1', 'call_2']);
    expect(r.output).toBe(
      ['again', '→ refund_order {}', '← {"ok":true}', 'again', '→ refund_order {}'].join('\n'),
    );
  });

  it('defaults to 5 steps', async () => {
    const provider = new MockProvider({ responder: () => ({ text: '', toolCalls: [call('refund_order', {})] }) });
    const r = await runToolLoop(provider, refundCase(), { timeoutMs: 1000 });
    expect(r.steps).toBe(5);
    expect(r.stoppedAtStepLimit).toBe(true);
  });

  it('returns just the text when the model calls no tool', async () => {
    const { provider } = scripted(['  No tools needed.  ']);
    const r = await runToolLoop(provider, refundCase(), { timeoutMs: 1000 });
    expect(r).toMatchObject({ output: '  No tools needed.  ', toolCalls: [], steps: 1, stoppedAtStepLimit: false });
  });

  it('starts from the case messages and context', async () => {
    const { provider, inputs } = scripted(['ok']);
    await runToolLoop(
      provider,
      refundCase({
        input: undefined,
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hello' },
          { role: 'user', content: 'refund it' },
        ],
        context: 'Order ORD-123 is delivered.',
      }),
      { timeoutMs: 1000 },
    );
    const turns = inputs[0] as ConversationTurn[];
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
    expect((turns[2] as { content: string }).content).toContain('Order ORD-123 is delivered.');
  });

  it('times out a slow step', async () => {
    const provider = new MockProvider({ responder: () => new Promise((r) => setTimeout(() => r('late'), 200)) });
    await expect(runToolLoop(provider, refundCase(), { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('enforces a total cap of timeoutMs × maxSteps', async () => {
    // Only Date is faked: each step "takes" 1.5 × timeoutMs of clock time but resolves at once,
    // so no single call times out, but after 2 steps the loop has used its 3 × 100ms cap.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let steps = 0;
      const provider = new MockProvider({
        responder: () => {
          steps++;
          vi.setSystemTime(Date.now() + 150);
          return { text: '', toolCalls: [call('refund_order', {})] };
        },
      });
      await expect(runToolLoop(provider, refundCase({ maxSteps: 3 }), { timeoutMs: 100 })).rejects.toMatchObject({
        code: 'TIMEOUT',
      });
      expect(steps).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Runner with multi-step cases', () => {
  const suiteOf = (...cases: TestCase[]): Suite => ({ version: 1, id: 's', name: 'S', cases });

  function spyChain() {
    const inputs: EvalInput[] = [];
    const chain = new EvaluatorChain([
      {
        evaluator: {
          name: 'spy',
          evaluate: async (i: EvalInput) => {
            inputs.push(i);
            return { score: 1 };
          },
        },
        weight: 1,
      },
    ]);
    return { inputs, chain };
  }

  it('runs the loop and passes every call, the loop info and summed usage on', async () => {
    const { provider } = scripted([
      { text: '', toolCalls: [call('get_order', { order_id: 'ORD-123' })] },
      { text: '', toolCalls: [call('refund_order', { order_id: 'ORD-123' })] },
      'Refunded.',
    ]);
    const { inputs, chain } = spyChain();
    const runner = new Runner({ provider, evaluator: chain, storage: new MemoryStorage() });
    const run = await runner.run(suiteOf(refundCase()));
    const c = run.cases[0];
    expect(c.status).toBe('pass');
    expect(c.tokenUsage).toEqual({ inputTokens: 30, outputTokens: 30, totalTokens: 60 });
    expect(c.output).toMatch(/\n\nRefunded\.$/);
    expect(inputs[0].output).toBe(c.output);
    expect(inputs[0].toolCalls?.map((t) => t.name)).toEqual(['get_order', 'refund_order']);
    expect(inputs[0].toolLoop).toEqual({ steps: 3, stoppedAtStepLimit: false });
  });

  it('classifies a provider error mid-loop as today', async () => {
    const e = Object.assign(new Error('rate limit exceeded'), { status: 429 });
    const { provider } = scripted([{ text: '', toolCalls: [call('get_order', { order_id: 'ORD-123' })] }, e]);
    const { inputs, chain } = spyChain();
    const runner = new Runner({ provider, evaluator: chain, storage: new MemoryStorage() });
    const run = await runner.run(suiteOf(refundCase()));
    expect(run.cases[0].status).toBe('provider-rate-limit');
    expect(run.cases[0].output).toBeNull();
    expect(run.cases[0].error).toBe('rate limit exceeded');
    expect(inputs).toHaveLength(0);
  });

  it('leaves a single-step tool case to one provider call', async () => {
    const { provider, inputs: sent } = scripted([{ text: '', toolCalls: [call('get_order', {})] }]);
    const { inputs, chain } = spyChain();
    const runner = new Runner({ provider, evaluator: chain, storage: new MemoryStorage() });
    const run = await runner.run(suiteOf({ id: 'one', input: 'q', tools }));
    expect(sent).toEqual(['q']);
    expect(run.cases[0].output).toBe('→ get_order {}');
    expect(inputs[0].toolLoop).toBeUndefined();
  });

  it('scores tool calls across steps with the tool-call evaluator and reports the loop', async () => {
    const { provider } = scripted([
      { text: '', toolCalls: [call('get_order', { order_id: 'ORD-123' })] },
      { text: '', toolCalls: [call('refund_order', { order_id: 'ORD-123' })] },
      'Refunded.',
    ]);
    const runner = new Runner({
      provider,
      evaluator: (tc) =>
        createEvaluatorChain(['tool-call'], { testProvider: new MockProvider(), case: tc }),
      storage: new MemoryStorage(),
    });
    const run = await runner.run(
      suiteOf(
        refundCase({
          expectedCalls: [
            { name: 'refund_order', arguments: { order_id: 'ORD-123' } },
            { name: 'get_order', arguments: { order_id: 'ORD-123' } },
          ],
        }),
      ),
    );
    expect(run.cases[0].score).toBe(1);
    expect(JSON.stringify(run.cases[0].evaluatorBreakdown)).toContain(
      '"toolLoop":{"steps":3,"stoppedAtStepLimit":false}',
    );
  });
});
