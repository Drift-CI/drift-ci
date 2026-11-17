import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic.js';
import type { ConversationTurn } from '../base.js';

function makeClient(response: Record<string, unknown>) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  };
}

function baseResponse(overrides: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: 'Hello from Claude' }],
    model: 'claude-sonnet-4-5',
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

describe('AnthropicProvider', () => {
  it('exposes a namespaced provider name', () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    expect(p.name).toBe('anthropic/claude-sonnet-4-5');
  });

  it('normalises a string input into a single user message', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete('hello');
    const args = client.messages.create.mock.calls[0][0];
    expect(args.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('passes through multi-turn messages unchanged', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
      { role: 'user', content: 'how are you' },
    ]);
    const args = client.messages.create.mock.calls[0][0];
    expect(args.messages).toHaveLength(3);
    expect(args.messages[1]).toEqual({ role: 'assistant', content: 'hey' });
  });

  it('defaults temperature to 0 for determinism', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete('x');
    expect(client.messages.create.mock.calls[0][0].temperature).toBe(0);
  });

  it('omits temperature for claude-4.7+ models that reject sampling params', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-opus-4-8', client });
    await p.complete('x');
    expect('temperature' in client.messages.create.mock.calls[0][0]).toBe(false);
  });

  it('omits temperature on a rejecting model even when explicitly provided', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-fable-5', client });
    await p.complete('x', undefined, { temperature: 0.7 });
    expect('temperature' in client.messages.create.mock.calls[0][0]).toBe(false);
  });

  it('sends system prompt with cache_control when cacheSystemPrompt is true', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete('x', 'You are helpful', { cacheSystemPrompt: true });
    const args = client.messages.create.mock.calls[0][0];
    expect(args.system).toEqual([
      {
        type: 'text',
        text: 'You are helpful',
        cache_control: { type: 'ephemeral' },
      },
    ]);
  });

  it('omits cache_control when cacheSystemPrompt is false', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete('x', 'You are helpful');
    const args = client.messages.create.mock.calls[0][0];
    expect(args.system[0]).not.toHaveProperty('cache_control');
  });

  it('joins all text blocks in the response', async () => {
    const client = makeClient(
      baseResponse({
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'tool_use' },
          { type: 'text', text: 'world' },
        ],
      }),
    );
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete('x');
    expect(res.text).toBe('Hello world');
  });

  it('reports token usage and latency', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete('x');
    expect(res.usage).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    expect(res.model).toBe('claude-sonnet-4-5');
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces cache_read_input_tokens when present', async () => {
    const client = makeClient(
      baseResponse({
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4 },
      }),
    );
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete('x');
    expect(res.usage.cachedInputTokens).toBe(4);
  });

  it('retries through 429s via withRetry', async () => {
    const err = Object.assign(new Error('rate limit'), { status: 429 });
    const create = vi
      .fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue(baseResponse());
    const p = new AnthropicProvider({
      model: 'claude-sonnet-4-5',
      client: { messages: { create } },
      retry: { maxRetries: 2, initialDelayMs: 1, jitterMs: 0, sleep: async () => {} },
    });
    const res = await p.complete('x');
    expect(res.text).toBe('Hello from Claude');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-rate-limit errors', async () => {
    const err = Object.assign(new Error('auth'), { status: 401 });
    const create = vi.fn().mockRejectedValue(err);
    const p = new AnthropicProvider({
      model: 'claude-sonnet-4-5',
      client: { messages: { create } },
      retry: { maxRetries: 3, initialDelayMs: 1, jitterMs: 0, sleep: async () => {} },
    });
    await expect(p.complete('x')).rejects.toMatchObject({ status: 401 });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('AnthropicProvider tools', () => {
  const tools = [
    {
      name: 'get_weather',
      description: 'Look up the weather',
      parameters: { type: 'object', properties: { city: { type: 'string' } } },
    },
  ];

  it('sends the tools mapped to input_schema, without tool_choice', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete('hi', undefined, { tools });
    const args = client.messages.create.mock.calls[0][0];
    expect(args.tools).toEqual([
      {
        name: 'get_weather',
        description: 'Look up the weather',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ]);
    expect(args).not.toHaveProperty('tool_choice');
  });

  it('parses one tool_use block', async () => {
    const client = makeClient(
      baseResponse({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } }],
      }),
    );
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.text).toBe('');
    expect(res.toolCalls).toEqual([{ id: 'tu_1', name: 'get_weather', arguments: { city: 'Paris' } }]);
  });

  it('returns text and two calls', async () => {
    const client = makeClient(
      baseResponse({
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'tu_1', name: 'get_weather', input: { city: 'Paris' } },
          { type: 'tool_use', id: 'tu_2', name: 'get_weather', input: { city: 'Rome' } },
        ],
      }),
    );
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.text).toBe('Checking.');
    expect(res.toolCalls).toEqual([
      { id: 'tu_1', name: 'get_weather', arguments: { city: 'Paris' } },
      { id: 'tu_2', name: 'get_weather', arguments: { city: 'Rome' } },
    ]);
  });

  it('returns toolCalls: [] when tools were offered but none called', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.toolCalls).toEqual([]);
    expect(res.text).toBe('Hello from Claude');
  });

  it('sends no tools key and leaves toolCalls undefined without tools', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete('hi', undefined, { tools: [] });
    const args = client.messages.create.mock.calls[0][0];
    expect(args).not.toHaveProperty('tools');
    expect(res).not.toHaveProperty('toolCalls');
  });
});

describe('AnthropicProvider tool conversations', () => {
  const tools = [{ name: 'get_order', parameters: { type: 'object' } }];
  const conversation: ConversationTurn[] = [
    { role: 'user', content: 'Refund ORD-1' },
    {
      role: 'assistant',
      content: 'Looking.',
      toolCalls: [
        { id: 'tu_1', name: 'get_order', arguments: { id: 'ORD-1' } },
        { id: 'tu_2', name: 'refund', arguments: { id: 'ORD-1' } },
      ],
    },
    {
      role: 'tool',
      results: [
        { callId: 'tu_1', name: 'get_order', content: '{"status":"delivered"}' },
        { callId: 'tu_2', name: 'refund', content: 'no result scripted', isError: true },
      ],
    },
  ];

  it('sends tool_use blocks and a user message of tool_result blocks', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete(conversation, undefined, { tools });
    expect(client.messages.create.mock.calls[0][0].messages).toEqual([
      { role: 'user', content: 'Refund ORD-1' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 'tu_1', name: 'get_order', input: { id: 'ORD-1' } },
          { type: 'tool_use', id: 'tu_2', name: 'refund', input: { id: 'ORD-1' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: '{"status":"delivered"}' },
          { type: 'tool_result', tool_use_id: 'tu_2', content: 'no result scripted', is_error: true },
        ],
      },
    ]);
  });

  it('leaves out the text block when the assistant turn has no text', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'tu_1', name: 'get_order', arguments: {} }] },
        { role: 'tool', results: [{ callId: 'tu_1', name: 'get_order', content: 'ok' }] },
      ],
      undefined,
      { tools },
    );
    expect(client.messages.create.mock.calls[0][0].messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_1', name: 'get_order', input: {} }],
    });
  });

  it('returns the provider ids, which round-trip into the next request', async () => {
    const client = makeClient(
      baseResponse({
        content: [{ type: 'tool_use', id: 'toolu_next', name: 'get_order', input: { id: 'ORD-2' } }],
      }),
    );
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    const res = await p.complete(conversation, undefined, { tools });
    expect(res.toolCalls).toEqual([{ id: 'toolu_next', name: 'get_order', arguments: { id: 'ORD-2' } }]);
    await p.complete(
      [
        ...conversation,
        { role: 'assistant', content: '', toolCalls: res.toolCalls },
        { role: 'tool', results: [{ callId: 'toolu_next', name: 'get_order', content: 'ok' }] },
      ],
      undefined,
      { tools },
    );
    const messages = client.messages.create.mock.calls[1][0].messages;
    expect(messages[3].content[0].id).toBe('toolu_next');
    expect(messages[4].content[0].tool_use_id).toBe('toolu_next');
  });

  it('sends a text-only conversation exactly as before', async () => {
    const client = makeClient(baseResponse());
    const p = new AnthropicProvider({ model: 'claude-sonnet-4-5', client });
    await p.complete(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey', toolCalls: [] },
        { role: 'user', content: 'again' },
      ],
      'sys',
      { tools },
    );
    expect(client.messages.create.mock.calls[0][0]).toStrictEqual({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      temperature: 0,
      system: [{ type: 'text', text: 'sys' }],
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey' },
        { role: 'user', content: 'again' },
      ],
      tools: [{ name: 'get_order', input_schema: { type: 'object' } }],
    });
  });
});
