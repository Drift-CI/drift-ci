import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic.js';

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
