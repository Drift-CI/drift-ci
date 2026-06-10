import { describe, it, expect, vi } from 'vitest';
import { BedrockAnthropicProvider } from '../bedrock.js';

function okResponse(model: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_bedrock',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: 'hi from bedrock' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 20, output_tokens: 5 },
    ...overrides,
  };
}

function fakeClient() {
  const create = vi.fn();
  return {
    client: { messages: { create } },
    create,
  };
}

describe('BedrockAnthropicProvider', () => {
  const MODEL_ID = 'anthropic.claude-sonnet-4-5-20260101-v1:0';

  it('names itself `bedrock/<modelId>`', () => {
    const { client } = fakeClient();
    const p = new BedrockAnthropicProvider({ modelId: MODEL_ID, client });
    expect(p.name).toBe(`bedrock/${MODEL_ID}`);
  });

  it('accepts `model` as an alias for `modelId`', () => {
    const { client } = fakeClient();
    const p = new BedrockAnthropicProvider({ model: MODEL_ID, client });
    expect(p.name).toBe(`bedrock/${MODEL_ID}`);
  });

  it('throws when neither modelId nor model is supplied', () => {
    const { client } = fakeClient();
    expect(
      () => new BedrockAnthropicProvider({ client } as never),
    ).toThrowError(/modelId.*required/);
  });

  it('routes the request through the injected client with the messages shape', async () => {
    const { client, create } = fakeClient();
    create.mockResolvedValue(okResponse(MODEL_ID));
    const p = new BedrockAnthropicProvider({ modelId: MODEL_ID, client });
    await p.complete('user says hi', 'system preface');
    const args = create.mock.calls[0][0];
    expect(args.model).toBe(MODEL_ID);
    expect(args.max_tokens).toBe(1024);
    expect(args.temperature).toBe(0);
    expect(args.messages).toEqual([{ role: 'user', content: 'user says hi' }]);
    expect(args.system?.[0]?.text).toBe('system preface');
    // No cache_control without cacheSystemPrompt.
    expect(args.system?.[0]?.cache_control).toBeUndefined();
  });

  it('applies cache_control: ephemeral when cacheSystemPrompt is set', async () => {
    const { client, create } = fakeClient();
    create.mockResolvedValue(okResponse(MODEL_ID));
    const p = new BedrockAnthropicProvider({ modelId: MODEL_ID, client });
    await p.complete('q', 'system preface', { cacheSystemPrompt: true });
    expect(create.mock.calls[0][0].system?.[0]?.cache_control).toEqual({
      type: 'ephemeral',
    });
  });

  it('extracts text blocks and ignores other content types', async () => {
    const { client, create } = fakeClient();
    create.mockResolvedValue(
      okResponse(MODEL_ID, {
        content: [
          { type: 'tool_use', id: 'x', name: 'noop', input: {} },
          { type: 'text', text: 'part A ' },
          { type: 'text', text: 'part B' },
        ],
      }),
    );
    const p = new BedrockAnthropicProvider({ modelId: MODEL_ID, client });
    const out = await p.complete('q');
    expect(out.text).toBe('part A part B');
  });

  it('surfaces cache_read_input_tokens as cachedInputTokens', async () => {
    const { client } = fakeClient();
    client.messages.create.mockResolvedValue(
      okResponse(MODEL_ID, {
        usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 88 },
      }),
    );
    const p = new BedrockAnthropicProvider({ modelId: MODEL_ID, client });
    const out = await p.complete('q');
    expect(out.usage.cachedInputTokens).toBe(88);
    expect(out.usage.totalTokens).toBe(105);
  });

  it('omits cachedInputTokens when not present', async () => {
    const { client, create } = fakeClient();
    create.mockResolvedValue(okResponse(MODEL_ID));
    const p = new BedrockAnthropicProvider({ modelId: MODEL_ID, client });
    const out = await p.complete('q');
    expect('cachedInputTokens' in out.usage).toBe(false);
  });

  it('retries on 429 via withRetry then succeeds', async () => {
    let calls = 0;
    const create = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        const err = new Error('rate limit') as Error & { status: number };
        err.status = 429;
        return Promise.reject(err);
      }
      return Promise.resolve(okResponse(MODEL_ID));
    });
    const p = new BedrockAnthropicProvider({
      modelId: MODEL_ID,
      client: { messages: { create } },
      retry: {
        maxRetries: 2,
        initialDelayMs: 0,
        jitterMs: 0,
        sleep: () => Promise.resolve(),
      },
    });
    const out = await p.complete('q');
    expect(out.text).toBe('hi from bedrock');
    expect(create).toHaveBeenCalledTimes(2);
  });
});
