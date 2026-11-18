import { describe, expect, it } from 'vitest';
import { traceToCase } from '../trace.js';
import { TestCaseSchema } from '../../types/index.js';

const opts = { prefix: 'prod' };

function ok(trace: unknown) {
  const r = traceToCase(trace, opts);
  if (!r.ok) throw new Error(`expected ok, got skip: ${r.reason}`);
  return r;
}
function skip(trace: unknown) {
  const r = traceToCase(trace, opts);
  if (r.ok) throw new Error('expected a skip');
  return r.reason;
}

describe('traceToCase: OpenAI shape', () => {
  it('turns one user turn + reply into input/expected', () => {
    const r = ok({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
    });
    expect(r.case.systemPrompt).toBe('Be brief.');
    expect(r.case.input).toBe('Hi');
    expect(r.case.messages).toBeUndefined();
    expect(r.case.expected).toBe('Hello!');
    expect(r.case.tags).toEqual(['imported']);
    expect(r.case.id).toMatch(/^prod-[0-9a-f]{12}$/);
    expect(r.redactions).toBe(0);
    expect(() => TestCaseSchema.parse(r.case)).not.toThrow();
  });

  it('turns a multi-turn conversation into messages ending with a user turn', () => {
    const r = ok({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: 'd' },
      ],
    });
    expect(r.case.input).toBeUndefined();
    expect(r.case.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
    expect(r.case.expected).toBe('d');
    expect(r.case.systemPrompt).toBeUndefined();
  });

  it('joins system and developer messages with a blank line', () => {
    const r = ok({
      messages: [
        { role: 'system', content: 'One.' },
        { role: 'developer', content: 'Two.' },
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ],
    });
    expect(r.case.systemPrompt).toBe('One.\n\nTwo.');
  });

  it('joins text content parts with a newline', () => {
    const r = ok({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'line 1' }, { type: 'text', text: 'line 2' }] },
        { role: 'assistant', content: 'ok' },
      ],
    });
    expect(r.case.input).toBe('line 1\nline 2');
  });
});

describe('traceToCase: Anthropic shape', () => {
  it('reads a top-level system string', () => {
    const r = ok({
      system: 'Sys',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'text', text: 'a' }] },
      ],
    });
    expect(r.case.systemPrompt).toBe('Sys');
    expect(r.case.expected).toBe('a');
  });

  it('reads a top-level system given as text blocks', () => {
    const r = ok({
      system: [{ type: 'text', text: 'S1' }, { type: 'text', text: 'S2' }],
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ],
    });
    expect(r.case.systemPrompt).toBe('S1\nS2');
  });
});

describe('traceToCase: skips', () => {
  const qa = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a' },
  ];

  it.each([
    ['a string', 'not-a-chat-trace', 'hello'],
    ['no messages', 'not-a-chat-trace', { foo: 1 }],
    ['an unknown role', 'not-a-chat-trace', { messages: [{ role: 'robot', content: 'x' }, ...qa] }],
    ['an image part', 'non-text content', {
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }, qa[1]],
    }],
    ['a tool_use block in a user turn', 'non-text content', {
      messages: [{ role: 'user', content: [{ type: 'tool_use', id: 't', name: 'f', input: {} }] }, qa[1]],
    }],
    ['a system message after a user turn', 'system message mid-conversation', {
      messages: [qa[0], { role: 'system', content: 's' }, qa[1]],
    }],
    ['no user turn', 'no user turn', { messages: [{ role: 'assistant', content: 'a' }] }],
    ['a final user turn', 'no final assistant reply', { messages: [qa[0]] }],
    ['two user turns in a row', 'roles do not alternate', {
      messages: [qa[0], qa[0], qa[1]],
    }],
    ['starting with assistant', 'roles do not alternate', {
      messages: [qa[1], qa[0], qa[1]],
    }],
    ['legacy function role', 'legacy function calls', {
      messages: [qa[0], { role: 'function', name: 'f', content: 'r' }, qa[1]],
    }],
    ['legacy function_call', 'legacy function calls', {
      messages: [qa[0], { role: 'assistant', content: 'calling', function_call: { name: 'f', arguments: '{}' } }],
    }],
    ['a redacted_thinking-only reply', 'empty content', {
      messages: [qa[0], { role: 'assistant', content: [{ type: 'redacted_thinking', data: 'x' }] }],
    }],
    ['null content', 'empty content', { messages: [qa[0], { role: 'assistant', content: null }] }],
    ['missing content', 'empty content', { messages: [qa[0], { role: 'assistant' }] }],
    ['empty content array', 'empty content', { messages: [qa[0], { role: 'assistant', content: [] }] }],
    ['an empty reply', 'empty content', { messages: [qa[0], { role: 'assistant', content: '  ' }] }],
  ])('skips %s', (_label, reason, trace) => {
    expect(skip(trace)).toBe(reason);
  });

  it('drops thinking parts and keeps the text', () => {
    const r = ok({
      messages: [
        qa[0],
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm', signature: 's' },
            { type: 'redacted_thinking', data: 'x' },
            { type: 'text', text: 'answer' },
          ],
        },
      ],
    });
    expect(r.case.expected).toBe('answer');
  });

  it('treats a null top-level system as absent', () => {
    expect(ok({ system: null, messages: qa }).case.systemPrompt).toBeUndefined();
  });

  it('accepts an empty tool_calls array as no tool calls', () => {
    expect(ok({ messages: [qa[0], { ...qa[1], tool_calls: [] }] }).case.expected).toBe('a');
  });
});

describe('traceToCase: ids', () => {
  const messages = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: 'a' },
  ];

  it('uses a sanitised trace id', () => {
    expect(ok({ id: 'Trace 42/ABC!', messages }).case.id).toBe('prod-trace-42-abc');
  });

  it('caps the trace id at 80 characters', () => {
    const id = ok({ id: 'x'.repeat(200), messages }).case.id;
    expect(id).toBe(`prod-${'x'.repeat(80)}`);
  });

  it('falls back to the hash when the id sanitises to nothing', () => {
    expect(ok({ id: '!!!', messages }).case.id).toMatch(/^prod-[0-9a-f]{12}$/);
  });

  it('gives equal traces equal ids and different traces different ids', () => {
    const a = ok({ messages }).case.id;
    const b = ok({ messages: messages.map((m) => ({ ...m })) }).case.id;
    const c = ok({ messages: [messages[0], { role: 'assistant', content: 'other' }] }).case.id;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('uses a numeric trace id', () => {
    expect(ok({ id: 42, messages }).case.id).toBe('prod-42');
  });

  it('redacts a secret in the trace id and counts it', () => {
    const r = ok({ id: `sk-ant-${'a'.repeat(20)}`, messages });
    expect(r.case.id).toBe('prod-redacted-anthropic-key');
    expect(r.redactions).toBe(1);
  });

  it('hashes after redaction, so traces differing only in a secret share an id', () => {
    const mk = (c: string) => ok({ messages: [{ role: 'user', content: `k sk-ant-${c.repeat(20)}` }, messages[1]] });
    expect(mk('a').case.id).toBe(mk('b').case.id);
  });

  it('rejects an invalid prefix', () => {
    expect(() => traceToCase({ messages }, { prefix: 'Bad Prefix' })).toThrow(/prefix/);
  });
});

describe('traceToCase: redaction', () => {
  it('redacts secrets in every field and counts them', () => {
    const key = `sk-ant-${'a'.repeat(20)}`;
    const r = ok({
      messages: [
        { role: 'system', content: `key ${key}` },
        { role: 'user', content: `my key is ${key}` },
        { role: 'assistant', content: 'noted' },
      ],
    });
    expect(r.case.systemPrompt).toBe('key [REDACTED:anthropic-key]');
    expect(r.case.input).toBe('my key is [REDACTED:anthropic-key]');
    expect(r.redactions).toBe(2);
  });

  it('redacts secrets in earlier messages and in expected', () => {
    const key = `sk-ant-${'a'.repeat(20)}`;
    const r = ok({
      messages: [
        { role: 'user', content: `k ${key}` },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'assistant', content: `use ${key}` },
      ],
    });
    expect(r.case.messages?.[0].content).toBe('k [REDACTED:anthropic-key]');
    expect(r.case.expected).toBe('use [REDACTED:anthropic-key]');
    expect(r.redactions).toBe(2);
  });
});

describe('traceToCase: text-only regression', () => {
  it('keeps the exact id and output of a text-only trace', () => {
    const r = ok({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ],
    });
    expect(JSON.stringify(r.case)).toBe(
      '{"id":"prod-b3076a6def56","systemPrompt":"Be brief.","input":"Hi","expected":"Hello!","tags":["imported"]}',
    );
  });

  it('ignores tools sent with a trace that makes no calls', () => {
    const r = ok({
      tools: 'not even valid',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'a' },
      ],
    });
    expect(r.case.tools).toBeUndefined();
    expect(r.case.tags).toEqual(['imported']);
  });
});

// ─── tool traces ──────────────────────────────────────────────────────

type Call = { id: string; name: string; args: unknown };

const oaCall = (calls: Call[], content: unknown = null) => ({
  role: 'assistant',
  content,
  tool_calls: calls.map((c) => ({
    id: c.id,
    type: 'function',
    function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) },
  })),
});
const oaResult = (id: string, content: unknown) => ({ role: 'tool', tool_call_id: id, content });

const anCall = (calls: Call[], text?: string) => ({
  role: 'assistant',
  content: [
    ...(text ? [{ type: 'text', text }] : []),
    ...calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
  ],
});
const anResults = (rs: { id: string; content: unknown; is_error?: boolean }[]) => ({
  role: 'user',
  content: rs.map((r) => ({
    type: 'tool_result',
    tool_use_id: r.id,
    content: r.content,
    ...(r.is_error ? { is_error: true } : {}),
  })),
});

const oaSteps = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    oaCall([{ id: `c${i}`, name: 'step', args: { i } }]),
    oaResult(`c${i}`, `r${i}`),
  ]).flat();
const parallel = (n: number) => [
  oaCall(Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: 'f', args: { i } }))),
  ...Array.from({ length: n }, (_, i) => oaResult(`c${i}`, 'r')),
];

const getOrder: Call = { id: 'call_1', name: 'get_order', args: { order_id: 'ORD-1' } };
const shipped = '{"status":"shipped"}';
const user = { role: 'user', content: 'Where is ORD-1?' };
const final = { role: 'assistant', content: 'It shipped.' };

const expectedOneStep = {
  input: 'Where is ORD-1?',
  toolResults: [{ name: 'get_order', arguments: { order_id: 'ORD-1' }, result: shipped }],
  expectedCalls: [{ name: 'get_order', arguments: { order_id: 'ORD-1' } }],
  expected: 'It shipped.',
  evaluators: ['tool-call', 'llm-judge'],
  tags: ['imported', 'tools'],
};

describe('traceToCase: tool traces', () => {
  it('turns an OpenAI one-step tool trace into a multi-step case', () => {
    const r = ok({ messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), final] });
    expect(r.case).toStrictEqual({ id: expect.stringMatching(/^prod-[0-9a-f]{12}$/), ...expectedOneStep });
    expect(Object.keys(r.case)).toEqual([
      'id', 'input', 'toolResults', 'expectedCalls', 'expected', 'evaluators', 'tags',
    ]);
    expect(r.redactions).toBe(0);
    expect(() => TestCaseSchema.parse(r.case)).not.toThrow();
  });

  it('turns the same flow in Anthropic shape into the same case', () => {
    const r = ok({
      messages: [
        user,
        anCall([getOrder]),
        anResults([{ id: 'call_1', content: [{ type: 'text', text: shipped }] }]),
        final,
      ],
    });
    const { id, ...rest } = r.case;
    expect(id).toMatch(/^prod-[0-9a-f]{12}$/);
    expect(rest).toStrictEqual(expectedOneStep);
  });

  it('gives the OpenAI and Anthropic recordings of one flow the same id', () => {
    const a = ok({ messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), final] });
    const b = ok({ messages: [user, anCall([getOrder]), anResults([{ id: 'call_1', content: shipped }]), final] });
    expect(a.case.id).toBe(b.case.id);
  });

  it('keeps the system prompt and earlier history, in field order', () => {
    const r = ok({
      tools: [{ name: 'get_order' }],
      messages: [
        { role: 'system', content: 'Sys' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        user,
        oaCall([getOrder]),
        oaResult('call_1', shipped),
        final,
      ],
    });
    expect(r.case.systemPrompt).toBe('Sys');
    expect(r.case.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'Where is ORD-1?' },
    ]);
    expect(Object.keys(r.case)).toEqual([
      'id', 'systemPrompt', 'messages', 'tools', 'toolResults', 'expectedCalls', 'expected', 'evaluators', 'tags',
    ]);
  });

  it('handles two steps', () => {
    const refund: Call = { id: 'call_2', name: 'refund_order', args: { order_id: 'ORD-1', amount: 5 } };
    const r = ok({
      messages: [
        user,
        oaCall([getOrder]),
        oaResult('call_1', shipped),
        oaCall([refund]),
        oaResult('call_2', '{"ok":true}'),
        final,
      ],
    });
    expect(r.case.expectedCalls).toEqual([
      { name: 'get_order', arguments: { order_id: 'ORD-1' } },
      { name: 'refund_order', arguments: { order_id: 'ORD-1', amount: 5 } },
    ]);
    expect(r.case.toolResults).toEqual([
      { name: 'get_order', arguments: { order_id: 'ORD-1' }, result: shipped },
      { name: 'refund_order', arguments: { order_id: 'ORD-1', amount: 5 }, result: '{"ok":true}' },
    ]);
    expect(r.case.maxSteps).toBeUndefined();
  });

  it('matches parallel results by id, not position', () => {
    const a: Call = { id: 'a', name: 'get_order', args: { order_id: 'A' } };
    const b: Call = { id: 'b', name: 'get_order', args: { order_id: 'B' } };
    const openai = ok({ messages: [user, oaCall([a, b]), oaResult('b', 'rb'), oaResult('a', 'ra'), final] });
    const anthropic = ok({
      messages: [user, anCall([a, b]), anResults([{ id: 'b', content: 'rb' }, { id: 'a', content: 'ra' }]), final],
    });
    for (const r of [openai, anthropic]) {
      expect(r.case.toolResults).toEqual([
        { name: 'get_order', arguments: { order_id: 'A' }, result: 'ra' },
        { name: 'get_order', arguments: { order_id: 'B' }, result: 'rb' },
      ]);
    }
    expect(openai.case.id).toBe(anthropic.case.id);
  });

  it('sets maxSteps only when the recording took more than 5 replies', () => {
    expect(ok({ messages: [user, ...oaSteps(4), final] }).case.maxSteps).toBeUndefined();
    expect(ok({ messages: [user, ...oaSteps(5), final] }).case.maxSteps).toBe(6);
    expect(ok({ messages: [user, ...oaSteps(9), final] }).case.maxSteps).toBe(10);
  });

  it('accepts 16 calls in one step', () => {
    expect(ok({ messages: [user, ...parallel(16), final] }).case.expectedCalls).toHaveLength(16);
  });

  it('passes normalised tools through', () => {
    const parameters = { type: 'object', properties: { order_id: { type: 'string' } } };
    const r = ok({
      tools: [{ type: 'function', function: { name: 'get_order', description: 'Look up an order', parameters } }],
      messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), final],
    });
    expect(r.case.tools).toEqual([{ name: 'get_order', description: 'Look up an order', parameters }]);
    const an = ok({
      tools: [{ name: 'get_order', input_schema: parameters }, { name: 'ping' }],
      messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), final],
    });
    expect(an.case.tools).toStrictEqual([{ name: 'get_order', parameters }, { name: 'ping' }]);
  });

  it('leaves out an empty tools array', () => {
    const r = ok({ tools: [], messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), final] });
    expect('tools' in r.case).toBe(false);
  });

  it('collapses identical calls with identical results into one toolResults entry', () => {
    const r = ok({
      messages: [
        user,
        oaCall([getOrder]),
        oaResult('call_1', shipped),
        oaCall([{ ...getOrder, id: 'call_2' }]),
        oaResult('call_2', shipped),
        final,
      ],
    });
    expect(r.case.toolResults).toEqual([{ name: 'get_order', arguments: { order_id: 'ORD-1' }, result: shipped }]);
    expect(r.case.expectedCalls).toHaveLength(2);
  });

  it('keeps different results for the same call as separate entries', () => {
    const r = ok({
      messages: [
        user,
        oaCall([getOrder]),
        oaResult('call_1', 'one'),
        oaCall([{ ...getOrder, id: 'call_2' }]),
        oaResult('call_2', 'two'),
        final,
      ],
    });
    expect(r.case.toolResults?.map((t) => t.result)).toEqual(['one', 'two']);
  });

  it('drops free-text arguments and omits empty arguments', () => {
    const r = ok({
      messages: [
        user,
        oaCall([
          { id: 'a', name: 'note', args: { text: 'x'.repeat(41) } },
          { id: 'b', name: 'note', args: { order_id: 'ORD-1', meta: { lines: ['ok', 'a\nb'] }, n: 'x'.repeat(40) } },
          { id: 'c', name: 'ping', args: {} },
        ]),
        oaResult('a', 'ra'),
        oaResult('b', 'rb'),
        oaResult('c', 'rc'),
        final,
      ],
    });
    expect(r.case.expectedCalls).toStrictEqual([
      { name: 'note' },
      { name: 'note', arguments: { order_id: 'ORD-1', n: 'x'.repeat(40) } },
      { name: 'ping' },
    ]);
    expect(r.case.toolResults).toStrictEqual([
      { name: 'note', result: 'ra' },
      { name: 'note', arguments: { order_id: 'ORD-1', n: 'x'.repeat(40) }, result: 'rb' },
      { name: 'ping', result: 'rc' },
    ]);
  });

  it('joins result text parts with a newline and keeps an error result', () => {
    const r = ok({
      messages: [
        user,
        anCall([getOrder]),
        anResults([
          { id: 'call_1', content: [{ type: 'text', text: 'not' }, { type: 'text', text: 'found' }], is_error: true },
        ]),
        final,
      ],
    });
    expect(r.case.toolResults?.[0].result).toBe('not\nfound');
  });

  it('reads OpenAI tool content given as text parts', () => {
    const r = ok({ messages: [user, oaCall([getOrder]), oaResult('call_1', [{ type: 'text', text: shipped }]), final] });
    expect(r.case.toolResults?.[0].result).toBe(shipped);
  });

  it('drops the text of an assistant step and keeps only the final reply', () => {
    const r = ok({
      messages: [user, anCall([getOrder], 'Let me check.'), anResults([{ id: 'call_1', content: shipped }]), final],
    });
    expect(r.case.expected).toBe('It shipped.');
    expect(JSON.stringify(r.case)).not.toContain('Let me check');
    const o = ok({ messages: [user, oaCall([getOrder], 'Checking'), oaResult('call_1', shipped), final] });
    expect(JSON.stringify(o.case)).not.toContain('Checking');
  });

  it('gives traces differing only in a tool result different ids', () => {
    const a = ok({ messages: [user, oaCall([getOrder]), oaResult('call_1', 'one'), final] });
    const b = ok({ messages: [user, oaCall([getOrder]), oaResult('call_1', 'two'), final] });
    expect(a.case.id).not.toBe(b.case.id);
  });

  it('gives traces differing only in a filtered argument different ids', () => {
    const mk = (t: string) =>
      ok({ messages: [user, oaCall([{ id: 'c', name: 'note', args: { text: t } }]), oaResult('c', 'r'), final] });
    expect(mk('a'.repeat(50)).case.id).not.toBe(mk('b'.repeat(50)).case.id);
  });

  it('ignores call ids in the hash', () => {
    const a = ok({ messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), final] });
    const b = ok({ messages: [user, oaCall([{ ...getOrder, id: 'x' }]), oaResult('x', shipped), final] });
    expect(a.case.id).toBe(b.case.id);
  });

  it('uses the trace id when given', () => {
    const r = ok({ id: 'T1', messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), final] });
    expect(r.case.id).toBe('prod-t1');
  });

  it('redacts secrets in arguments, results and tool definitions and counts them', () => {
    const key = `sk-ant-${'a'.repeat(20)}`;
    const longKey = `sk-ant-${'b'.repeat(40)}`; // over 40 characters until redacted
    const r = ok({
      tools: [
        {
          name: 'get_order',
          description: `uses ${key}`,
          input_schema: { type: 'object', properties: { k: { type: 'string', default: key } } },
        },
      ],
      messages: [
        user,
        oaCall([{ id: 'c', name: 'get_order', args: { token: key, nested: [longKey] } }]),
        oaResult('c', `result ${key}`),
        final,
      ],
    });
    const red = '[REDACTED:anthropic-key]';
    expect(r.case.expectedCalls).toEqual([{ name: 'get_order', arguments: { token: red, nested: [red] } }]);
    expect(r.case.toolResults).toEqual([
      { name: 'get_order', arguments: { token: red, nested: [red] }, result: `result ${red}` },
    ]);
    expect(r.case.tools).toEqual([
      {
        name: 'get_order',
        description: `uses ${red}`,
        parameters: { type: 'object', properties: { k: { type: 'string', default: red } } },
      },
    ]);
    expect(r.redactions).toBe(5);
    expect(JSON.stringify(r.case)).not.toContain('sk-ant-');
  });

  it('hashes after redaction, so tool steps differing only in a secret share an id', () => {
    const mk = (c: string) =>
      ok({
        messages: [user, oaCall([{ id: 'c', name: 'f', args: { k: `sk-ant-${c.repeat(20)}` } }]), oaResult('c', 'r'), final],
      });
    expect(mk('a').case.id).toBe(mk('b').case.id);
  });
});

describe('traceToCase: tool trace skips', () => {
  const step = [oaCall([getOrder]), oaResult('call_1', shipped)];

  it.each([
    ['a function role message', 'legacy function calls', {
      messages: [user, { role: 'function', name: 'f', content: 'r' }, final],
    }],
    ['an assistant function_call', 'legacy function calls', {
      messages: [user, { role: 'assistant', content: null, function_call: { name: 'f', arguments: '{}' } }, final],
    }],
    ['a tool step before a later user turn', 'tool calls before the last user message', {
      messages: [user, ...step, final, { role: 'user', content: 'thanks' }, { role: 'assistant', content: 'bye' }],
    }],
    ['an Anthropic tool step before a later user turn', 'tool calls before the last user message', {
      messages: [
        user,
        anCall([getOrder]),
        anResults([{ id: 'call_1', content: 'r' }]),
        final,
        { role: 'user', content: 'x' },
        final,
      ],
    }],
    ['a final reply with tool calls', 'final reply calls tools', {
      messages: [user, ...step, oaCall([{ ...getOrder, id: 'call_9' }])],
    }],
    ['a final Anthropic tool_use reply', 'final reply calls tools', {
      messages: [user, anCall([getOrder])],
    }],
    ['a trace ending on tool results', 'final reply calls tools', {
      messages: [user, ...step],
    }],
    ['a missing result', 'unanswered tool call', {
      messages: [user, oaCall([getOrder, { id: 'call_2', name: 'f', args: {} }]), oaResult('call_1', shipped), final],
    }],
    ['a call with no results at all', 'unanswered tool call', {
      messages: [user, oaCall([getOrder]), oaCall([{ ...getOrder, id: 'call_2' }]), oaResult('call_2', 'r'), final],
    }],
    ['a result for an unknown id', 'unanswered tool call', {
      messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), oaResult('nope', 'r'), final],
    }],
    ['a result with no call', 'unanswered tool call', {
      messages: [user, oaResult('call_1', shipped), final],
    }],
    ['a result with no id', 'unanswered tool call', {
      messages: [user, oaCall([getOrder]), { role: 'tool', content: 'r' }, final],
    }],
    ['a duplicate result', 'unanswered tool call', {
      messages: [user, oaCall([getOrder]), oaResult('call_1', shipped), oaResult('call_1', shipped), final],
    }],
    ['a duplicate Anthropic result', 'unanswered tool call', {
      messages: [
        user,
        anCall([getOrder]),
        anResults([{ id: 'call_1', content: 'a' }, { id: 'call_1', content: 'b' }]),
        final,
      ],
    }],
    ['invalid JSON arguments', 'invalid tool arguments', {
      messages: [user, oaCall([{ ...getOrder, args: '{bad' }]), oaResult('call_1', shipped), final],
    }],
    ['JSON arguments that are not an object', 'invalid tool arguments', {
      messages: [user, oaCall([{ ...getOrder, args: '[1,2]' }]), oaResult('call_1', shipped), final],
    }],
    ['Anthropic input that is not an object', 'invalid tool arguments', {
      messages: [user, anCall([{ ...getOrder, args: 'x' }]), anResults([{ id: 'call_1', content: 'r' }]), final],
    }],
    ['invalid tool definitions', 'invalid tool definitions', {
      tools: [{ name: 'bad name' }],
      messages: [user, ...step, final],
    }],
    ['11 replies after the last user message', 'too many tool steps', {
      messages: [user, ...oaSteps(10), final],
    }],
    ['33 calls', 'too many tool steps', {
      messages: [user, ...parallel(33), final],
    }],
    ['17 calls (over the 16 expectedCalls limit)', 'too many tool steps', {
      messages: [user, ...parallel(17), final],
    }],
    ['an empty final reply', 'empty content', {
      messages: [user, ...step, { role: 'assistant', content: '' }],
    }],
    ['an image in a tool result', 'non-text content', {
      messages: [
        user,
        anCall([getOrder]),
        anResults([{ id: 'call_1', content: [{ type: 'image', source: {} }] }]),
        final,
      ],
    }],
    ['an assistant text reply between tool steps', 'roles do not alternate', {
      messages: [
        user,
        ...step,
        { role: 'assistant', content: 'hmm' },
        oaCall([{ ...getOrder, id: 'c2' }]),
        oaResult('c2', 'r'),
        final,
      ],
    }],
  ])('skips %s', (_label, reason, trace) => {
    expect(skip(trace)).toBe(reason);
  });
});
