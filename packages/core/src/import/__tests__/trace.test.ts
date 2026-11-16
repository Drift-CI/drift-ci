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
    expect(r.case.id).toMatch(/^prod-[0-9a-f]{8}$/);
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
    ['an Anthropic tool_use block', 'non-text content', {
      messages: [qa[0], { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'f', input: {} }] }],
    }],
    ['a tool role message', 'tool calls', {
      messages: [qa[0], { role: 'tool', content: 'r' }, qa[1]],
    }],
    ['assistant tool_calls', 'tool calls', {
      messages: [qa[0], { role: 'assistant', content: null, tool_calls: [{ id: '1' }] }],
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
    ['an empty reply', 'empty content', { messages: [qa[0], { role: 'assistant', content: '  ' }] }],
  ])('skips %s', (_label, reason, trace) => {
    expect(skip(trace)).toBe(reason);
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
    expect(ok({ id: '!!!', messages }).case.id).toMatch(/^prod-[0-9a-f]{8}$/);
  });

  it('gives equal traces equal ids and different traces different ids', () => {
    const a = ok({ messages }).case.id;
    const b = ok({ messages: messages.map((m) => ({ ...m })) }).case.id;
    const c = ok({ messages: [messages[0], { role: 'assistant', content: 'other' }] }).case.id;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
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
});
