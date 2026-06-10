import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '../openai.js';

function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-abc',
    model: 'gpt-4o-mini',
    object: 'chat.completion',
    created: 1,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'hi' },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    ...overrides,
  };
}

function makeClient(response = okResponse()) {
  const create = vi.fn().mockResolvedValue(response);
  return {
    client: { chat: { completions: { create } } },
    create,
  };
}

describe('OpenAIProvider', () => {
  it('throws without an apiKey and no OPENAI_API_KEY env', () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new OpenAIProvider({ model: 'gpt-4o' })).toThrowError(
        /OPENAI_API_KEY/,
      );
    } finally {
      if (original !== undefined) process.env.OPENAI_API_KEY = original;
    }
  });

  it('names itself `openai/<model>` by default', () => {
    const { client } = makeClient();
    const p = new OpenAIProvider({ model: 'gpt-4o-mini', client });
    expect(p.name).toBe('openai/gpt-4o-mini');
  });

  it('honours nameOverride (used by the Azure subclass)', () => {
    const { client } = makeClient();
    const p = new OpenAIProvider({
      model: 'deploy-a',
      client,
      nameOverride: 'azure/deploy-a',
    });
    expect(p.name).toBe('azure/deploy-a');
  });

  it('sends system prompt as a role:system message prefix', async () => {
    const { client, create } = makeClient();
    const p = new OpenAIProvider({ model: 'gpt-4o', client });
    await p.complete('user turn', 'system rules');
    const args = create.mock.calls[0][0];
    expect(args.messages).toEqual([
      { role: 'system', content: 'system rules' },
      { role: 'user', content: 'user turn' },
    ]);
    expect(args.model).toBe('gpt-4o');
    expect(args.temperature).toBe(0);
  });

  it('passes maxTokens and respects defaultMaxTokens', async () => {
    const { client, create } = makeClient();
    const p = new OpenAIProvider({ model: 'x', client, defaultMaxTokens: 333 });
    await p.complete('q', undefined, { maxTokens: 999 });
    expect(create.mock.calls[0][0].max_tokens).toBe(999);
    create.mockClear();
    await p.complete('q');
    expect(create.mock.calls[0][0].max_tokens).toBe(333);
  });

  it('extracts text from the first choice.message.content', async () => {
    const { client } = makeClient(
      okResponse({
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello world' },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      }),
    );
    const p = new OpenAIProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect(out.text).toBe('hello world');
  });

  it('surfaces cached_tokens from prompt_tokens_details', async () => {
    const { client } = makeClient(
      okResponse({
        usage: {
          prompt_tokens: 100,
          completion_tokens: 4,
          total_tokens: 104,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      }),
    );
    const p = new OpenAIProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(4);
    expect(out.usage.totalTokens).toBe(104);
    expect(out.usage.cachedInputTokens).toBe(80);
  });

  it('omits cachedInputTokens when the response has no cache details', async () => {
    const { client } = makeClient();
    const p = new OpenAIProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect('cachedInputTokens' in out.usage).toBe(false);
  });

  it('retries on 429 via withRetry then succeeds', async () => {
    const calls: unknown[] = [];
    const create = vi.fn().mockImplementation(() => {
      calls.push(null);
      if (calls.length === 1) {
        const err = new Error('rate limit') as Error & { status: number };
        err.status = 429;
        return Promise.reject(err);
      }
      return Promise.resolve(okResponse());
    });
    const p = new OpenAIProvider({
      model: 'x',
      client: { chat: { completions: { create } } },
      retry: {
        maxRetries: 2,
        initialDelayMs: 0,
        jitterMs: 0,
        sleep: () => Promise.resolve(),
      },
    });
    const out = await p.complete('q');
    expect(out.text).toBe('hi');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('propagates non-retryable errors', async () => {
    const err = new Error('bad request') as Error & { status: number };
    err.status = 400;
    const create = vi.fn().mockRejectedValue(err);
    const p = new OpenAIProvider({
      model: 'x',
      client: { chat: { completions: { create } } },
      retry: { maxRetries: 0 },
    });
    await expect(p.complete('q')).rejects.toThrow(/bad request/);
  });

  it('stringifies non-string message content for the SDK', async () => {
    const { client, create } = makeClient();
    const p = new OpenAIProvider({ model: 'x', client });
    await p.complete([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] as unknown as string },
    ]);
    const sent = create.mock.calls[0][0].messages;
    expect(typeof sent[0].content).toBe('string');
    expect(sent[0].content).toMatch(/"text":"hi"/);
  });
});
