import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '../mock.js';
import type { ConversationTurn } from '../base.js';
import { createProvider } from '../factory.js';

describe('MockProvider', () => {
  it('returns the default response for an unknown input', async () => {
    const p = new MockProvider({ defaultResponse: 'hi' });
    const r = await p.complete('anything');
    expect(r.text).toBe('hi');
    expect(r.usage.totalTokens).toBe(20);
  });

  it('returns a keyed response when the input matches', async () => {
    const p = new MockProvider({
      responses: { question: 'the answer' },
      defaultResponse: 'default',
    });
    expect((await p.complete('question')).text).toBe('the answer');
    expect((await p.complete('other')).text).toBe('default');
  });

  it('delegates to a custom responder when provided', async () => {
    const p = new MockProvider({
      responder: (input) =>
        typeof input === 'string' ? input.toUpperCase() : 'nope',
    });
    expect((await p.complete('shout')).text).toBe('SHOUT');
  });

  it('lets the responder return text with tool calls', async () => {
    const p = new MockProvider({
      responder: () => ({ text: 'looking', toolCalls: [{ name: 'get_order', arguments: { id: 1 } }] }),
    });
    const r = await p.complete('x');
    expect(r.text).toBe('looking');
    expect(r.toolCalls).toEqual([{ id: 'call_1', name: 'get_order', arguments: { id: 1 } }]);
  });

  it('keeps ids the responder sets and numbers the rest after the calls already in the conversation', async () => {
    const p = new MockProvider({
      responder: () => ({
        text: '',
        toolCalls: [
          { id: 'given', name: 'a', arguments: {} },
          { name: 'b', arguments: {} },
        ],
      }),
    });
    expect((await p.complete('x')).toolCalls?.map((c) => c.id)).toEqual(['given', 'call_2']);
    const conversation: ConversationTurn[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'a', arguments: {} },
          { id: 'call_2', name: 'a', arguments: {} },
        ],
      },
      {
        role: 'tool',
        results: [
          { callId: 'call_1', name: 'a', content: 'ok' },
          { callId: 'call_2', name: 'a', content: 'ok' },
        ],
      },
    ];
    expect((await p.complete(conversation)).toolCalls?.map((c) => c.id)).toEqual(['given', 'call_4']);
  });

  it('passes a tool conversation to the responder as-is', async () => {
    const seen: unknown[] = [];
    const conversation: ConversationTurn[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'looking', toolCalls: [{ id: 'call_1', name: 'a', arguments: { x: 1 } }] },
      { role: 'tool', results: [{ callId: 'call_1', name: 'a', content: 'boom', isError: true }] },
    ];
    const p = new MockProvider({
      responder: (input) => {
        seen.push(input);
        return 'done';
      },
    });
    expect((await p.complete(conversation)).text).toBe('done');
    expect(seen[0]).toBe(conversation);
  });

  it('leaves toolCalls undefined for a plain string or an object without calls', async () => {
    expect((await new MockProvider({ responder: () => 'hi' }).complete('x')).toolCalls).toBeUndefined();
    const r = await new MockProvider({ responder: async () => ({ text: 'hi' }) }).complete('x');
    expect(r.text).toBe('hi');
    expect('toolCalls' in r).toBe(false);
  });

  it('propagates errors returned by the responder', async () => {
    const p = new MockProvider({
      responder: () => {
        const e = new Error('rate limited');
        (e as Error & { status?: number }).status = 429;
        return e;
      },
    });
    await expect(p.complete('x')).rejects.toThrow('rate limited');
  });

  it('keys a conversation of a single user turn by its content, like single-step input', async () => {
    const p = new MockProvider({ responses: { question: 'the answer' }, defaultResponse: 'default' });
    const turns: ConversationTurn[] = [{ role: 'user', content: 'question' }];
    expect((await p.complete(turns)).text).toBe('the answer');
  });

  it('normalises messages array through toMessages via the factory', async () => {
    const p = new MockProvider({
      responses: {
        [JSON.stringify([{ role: 'user', content: 'hi' }])]: 'matched',
      },
    });
    const r = await p.complete([{ role: 'user', content: 'hi' }]);
    expect(r.text).toBe('matched');
  });
});

describe('createProvider mock gating', () => {
  const originalFlag = process.env.DRIFT_ENABLE_MOCK_PROVIDER;

  beforeEach(() => {
    delete process.env.DRIFT_ENABLE_MOCK_PROVIDER;
  });
  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.DRIFT_ENABLE_MOCK_PROVIDER;
    } else {
      process.env.DRIFT_ENABLE_MOCK_PROVIDER = originalFlag;
    }
  });

  it('throws when DRIFT_ENABLE_MOCK_PROVIDER is not "true"', () => {
    expect(() => createProvider({ name: 'mock' })).toThrow(
      'DRIFT_ENABLE_MOCK_PROVIDER=true',
    );
  });

  it('constructs a MockProvider when the flag is set', () => {
    process.env.DRIFT_ENABLE_MOCK_PROVIDER = 'true';
    const p = createProvider({ name: 'mock' });
    expect(p.name).toContain('mock');
  });

  it('rejects an unknown provider name', () => {
    expect(() =>
      createProvider({ name: 'not-a-real-provider' as unknown as 'mock' }),
    ).toThrow('Unknown provider');
  });
});
