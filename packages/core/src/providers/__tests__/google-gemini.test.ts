import { describe, it, expect, vi } from 'vitest';

import { GoogleGeminiProvider } from '../google-gemini.js';
import type { GoogleGenAILike } from '../google-base.js';
import type { ConversationTurn } from '../base.js';

function okResponse(overrides: Record<string, unknown> = {}) {
  return {
    text: 'hi',
    modelVersion: 'gemini-2.5-pro-001',
    usageMetadata: {
      promptTokenCount: 12,
      candidatesTokenCount: 3,
      totalTokenCount: 15,
    },
    ...overrides,
  };
}

function makeClient(response = okResponse()): {
  client: GoogleGenAILike;
  generateContent: ReturnType<typeof vi.fn>;
} {
  const generateContent = vi.fn().mockResolvedValue(response);
  return {
    client: { models: { generateContent } } as GoogleGenAILike,
    generateContent,
  };
}

describe('GoogleGeminiProvider', () => {
  it('throws without an apiKey and no GOOGLE_GENAI_API_KEY / GEMINI_API_KEY env', () => {
    const originalGGAK = process.env.GOOGLE_GENAI_API_KEY;
    const originalGAK = process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      expect(() => new GoogleGeminiProvider({ model: 'gemini-2.5-pro' })).toThrowError(
        /GOOGLE_GENAI_API_KEY/,
      );
    } finally {
      if (originalGGAK !== undefined) process.env.GOOGLE_GENAI_API_KEY = originalGGAK;
      if (originalGAK !== undefined) process.env.GEMINI_API_KEY = originalGAK;
    }
  });

  it('names itself `google/<model>`', () => {
    const { client } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-pro', client });
    expect(p.name).toBe('google/gemini-2.5-pro');
  });

  it('forwards a single string input as one user-role content entry', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    await p.complete('hello');
    const args = generateContent.mock.calls[0][0];
    expect(args.model).toBe('gemini-2.5-flash');
    expect(args.contents).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
    ]);
  });

  it('rebrands assistant turns as Gemini `model` role', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-pro', client });
    await p.complete([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
      { role: 'user', content: 'how are you' },
    ]);
    const args = generateContent.mock.calls[0][0];
    expect(args.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'hey' }] },
      { role: 'user', parts: [{ text: 'how are you' }] },
    ]);
  });

  it('sends system prompt via `config.systemInstruction`', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-pro', client });
    await p.complete('user turn', 'system rules');
    const args = generateContent.mock.calls[0][0];
    expect(args.config.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'system rules' }],
    });
  });

  it('omits `systemInstruction` when no system prompt is given', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-pro', client });
    await p.complete('user turn');
    const args = generateContent.mock.calls[0][0];
    expect(args.config.systemInstruction).toBeUndefined();
  });

  it('defaults temperature to 0 and respects the override', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'x', client });
    await p.complete('q');
    expect(generateContent.mock.calls[0][0].config.temperature).toBe(0);
    generateContent.mockClear();
    await p.complete('q', undefined, { temperature: 0.7 });
    expect(generateContent.mock.calls[0][0].config.temperature).toBe(0.7);
  });

  it('passes maxTokens via maxOutputTokens and respects defaultMaxTokens', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'x', client, defaultMaxTokens: 333 });
    await p.complete('q', undefined, { maxTokens: 999 });
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(999);
    generateContent.mockClear();
    await p.complete('q');
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(333);
  });

  it('extracts text and usage metadata from the response', async () => {
    const { client } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect(out.text).toBe('hi');
    expect(out.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
    });
    expect(out.model).toBe('gemini-2.5-pro-001');
  });

  it('surfaces cachedInputTokens when the response carries cachedContentTokenCount', async () => {
    const { client } = makeClient(
      okResponse({
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 4,
          cachedContentTokenCount: 80,
          totalTokenCount: 104,
        },
      }),
    );
    const p = new GoogleGeminiProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect(out.usage.cachedInputTokens).toBe(80);
  });

  it('omits cachedInputTokens when the response has no cache details', async () => {
    const { client } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect('cachedInputTokens' in out.usage).toBe(false);
  });

  it('falls back to inputTokens+outputTokens when totalTokenCount is missing', async () => {
    const { client } = makeClient(
      okResponse({
        usageMetadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 2,
        },
      }),
    );
    const p = new GoogleGeminiProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect(out.usage.totalTokens).toBe(9);
  });

  it('returns empty text when the response omits `text`', async () => {
    const { client } = makeClient(okResponse({ text: undefined }));
    const p = new GoogleGeminiProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect(out.text).toBe('');
  });

  it('retries on 429 via withRetry then succeeds', async () => {
    const calls: unknown[] = [];
    const generateContent = vi.fn().mockImplementation(() => {
      calls.push(null);
      if (calls.length === 1) {
        const err = new Error('rate limit') as Error & { status: number };
        err.status = 429;
        return Promise.reject(err);
      }
      return Promise.resolve(okResponse());
    });
    const p = new GoogleGeminiProvider({
      model: 'x',
      client: { models: { generateContent } } as GoogleGenAILike,
      retry: {
        maxRetries: 2,
        initialDelayMs: 0,
        jitterMs: 0,
        sleep: () => Promise.resolve(),
      },
    });
    const out = await p.complete('q');
    expect(out.text).toBe('hi');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it('propagates non-retryable errors', async () => {
    const err = new Error('bad request') as Error & { status: number };
    err.status = 400;
    const generateContent = vi.fn().mockRejectedValue(err);
    const p = new GoogleGeminiProvider({
      model: 'x',
      client: { models: { generateContent } } as GoogleGenAILike,
      retry: { maxRetries: 0 },
    });
    await expect(p.complete('q')).rejects.toThrow(/bad request/);
  });

  it('stringifies non-string message content for the SDK', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'x', client });
    await p.complete([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] as unknown as string },
    ]);
    const sent = generateContent.mock.calls[0][0].contents;
    expect(typeof sent[0].parts[0].text).toBe('string');
    expect(sent[0].parts[0].text).toMatch(/"text":"hi"/);
  });

  it('measures latencyMs as a non-negative number', async () => {
    const { client } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'x', client });
    const out = await p.complete('q');
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('GoogleGeminiProvider tools', () => {
  const tools = [
    {
      name: 'get_weather',
      description: 'Weather',
      parameters: { type: 'object', properties: { city: { type: 'string' } } },
    },
  ];
  const withParts = (parts: Array<Record<string, unknown>>) =>
    okResponse({ text: undefined, candidates: [{ content: { role: 'model', parts } }] });

  it('sends functionDeclarations inside config.tools', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    await p.complete('hi', undefined, { tools });
    const args = generateContent.mock.calls[0][0];
    expect(args.config.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: 'get_weather',
            description: 'Weather',
            parametersJsonSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      },
    ]);
    expect(args.config).not.toHaveProperty('toolConfig');
  });

  it('parses one function call from the candidate parts', async () => {
    const { client } = makeClient(
      withParts([{ functionCall: { name: 'get_weather', args: { city: 'Paris' } } }]),
    );
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.text).toBe('');
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'get_weather', arguments: { city: 'Paris' } }]);
  });

  it('returns text and two calls, skipping thought text', async () => {
    const { client } = makeClient(
      withParts([
        { text: 'thinking', thought: true },
        { text: 'Checking.' },
        { functionCall: { name: 'get_weather', args: { city: 'Paris' } } },
        { functionCall: { name: 'get_weather' } },
      ]),
    );
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.text).toBe('Checking.');
    expect(res.toolCalls).toEqual([
      { id: 'call_1', name: 'get_weather', arguments: { city: 'Paris' } },
      { id: 'call_2', name: 'get_weather', arguments: {} },
    ]);
  });

  it('falls back to response.functionCalls when there are no candidates', async () => {
    const { client } = makeClient(
      okResponse({ text: undefined, functionCalls: [{ name: 'get_weather', args: { city: 'Rome' } }] }),
    );
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.text).toBe('');
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'get_weather', arguments: { city: 'Rome' } }]);
  });

  it('reads a throwing text getter as empty', async () => {
    const response = {
      ...okResponse(),
      get text(): string {
        throw new Error('no text');
      },
    };
    const { client } = makeClient(response as unknown as ReturnType<typeof okResponse>);
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.text).toBe('');
    expect(res.toolCalls).toEqual([]);
  });

  it('returns toolCalls: [] when none called', async () => {
    const { client } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete('hi', undefined, { tools });
    expect(res.text).toBe('hi');
    expect(res.toolCalls).toEqual([]);
  });

  it('sends no tools key and leaves toolCalls undefined without tools', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete('hi', undefined, { tools: [] });
    const args = generateContent.mock.calls[0][0];
    expect(args).not.toHaveProperty('tools');
    expect(args.config).not.toHaveProperty('tools');
    expect(res).not.toHaveProperty('toolCalls');
  });
});

describe('GoogleGeminiProvider tool conversations', () => {
  const tools = [{ name: 'get_order', parameters: { type: 'object' } }];
  const withParts = (parts: Array<Record<string, unknown>>) =>
    okResponse({ text: undefined, candidates: [{ content: { role: 'model', parts } }] });
  const conversation: ConversationTurn[] = [
    { role: 'user', content: 'Refund ORD-1' },
    {
      role: 'assistant',
      content: 'Looking.',
      toolCalls: [
        { id: 'call_1', name: 'get_order', arguments: { id: 'ORD-1' } },
        { id: 'fc_given', name: 'refund', arguments: { id: 'ORD-1' } },
        { id: 'call_3', name: 'note', arguments: {} },
      ],
    },
    {
      role: 'tool',
      results: [
        { callId: 'call_1', name: 'get_order', content: '{"status":"delivered"}' },
        { callId: 'fc_given', name: 'refund', content: 'no result scripted', isError: true },
        { callId: 'call_3', name: 'note', content: 'saved' },
      ],
    },
  ];

  it('sends model functionCall parts and user functionResponse parts', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    await p.complete(conversation, undefined, { tools });
    expect(generateContent.mock.calls[0][0].contents).toEqual([
      { role: 'user', parts: [{ text: 'Refund ORD-1' }] },
      {
        role: 'model',
        parts: [
          { text: 'Looking.' },
          { functionCall: { name: 'get_order', args: { id: 'ORD-1' } } },
          { functionCall: { name: 'refund', args: { id: 'ORD-1' }, id: 'fc_given' } },
          { functionCall: { name: 'note', args: {} } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'get_order', response: { status: 'delivered' } } },
          { functionResponse: { name: 'refund', response: { error: 'no result scripted' }, id: 'fc_given' } },
          { functionResponse: { name: 'note', response: { result: 'saved' } } },
        ],
      },
    ]);
  });

  it('wraps a JSON result that is not an object', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    await p.complete(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_order', arguments: {} }] },
        { role: 'tool', results: [{ callId: 'call_1', name: 'get_order', content: '[1,2]' }] },
      ],
      undefined,
      { tools },
    );
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'get_order', args: {} } }] });
    expect(contents[2].parts[0].functionResponse.response).toEqual({ result: '[1,2]' });
  });

  it('generates call ids numbered on from the calls already in the conversation', async () => {
    const { client } = makeClient(
      withParts([
        { functionCall: { name: 'get_order', args: {} } },
        { functionCall: { name: 'get_order', args: { id: 'x' } } },
      ]),
    );
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete(conversation, undefined, { tools });
    expect(res.toolCalls).toEqual([
      { id: 'call_4', name: 'get_order', arguments: {} },
      { id: 'call_5', name: 'get_order', arguments: { id: 'x' } },
    ]);
  });

  it('returns a functionCall id when Gemini gives one, and sends it back', async () => {
    const { client, generateContent } = makeClient(
      withParts([{ functionCall: { id: 'g-123', name: 'get_order', args: {} } }]),
    );
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    const res = await p.complete(conversation, undefined, { tools });
    expect(res.toolCalls).toEqual([{ id: 'g-123', name: 'get_order', arguments: {} }]);
    await p.complete(
      [
        ...conversation,
        { role: 'assistant', content: '', toolCalls: res.toolCalls },
        { role: 'tool', results: [{ callId: 'g-123', name: 'get_order', content: '{}' }] },
      ],
      undefined,
      { tools },
    );
    const contents = generateContent.mock.calls[1][0].contents;
    expect(contents[3].parts[0].functionCall.id).toBe('g-123');
    expect(contents[4].parts[0].functionResponse).toEqual({ name: 'get_order', response: {}, id: 'g-123' });
  });

  it('sends a text-only conversation exactly as before', async () => {
    const { client, generateContent } = makeClient();
    const p = new GoogleGeminiProvider({ model: 'gemini-2.5-flash', client });
    await p.complete(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey' },
        { role: 'user', content: 'again' },
      ],
      'sys',
    );
    expect(generateContent.mock.calls[0][0]).toStrictEqual({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        { role: 'model', parts: [{ text: 'hey' }] },
        { role: 'user', parts: [{ text: 'again' }] },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 1024,
        systemInstruction: { role: 'user', parts: [{ text: 'sys' }] },
      },
    });
  });
});

describe('GoogleGeminiProvider thought signatures', () => {
  const tools = [{ name: 'get_order', parameters: { type: 'object' } }];
  const withParts = (parts: Array<Record<string, unknown>>) =>
    okResponse({ text: undefined, candidates: [{ content: { role: 'model', parts } }] });

  async function twoSteps(parts: Array<Record<string, unknown>>) {
    const { client, generateContent } = makeClient(withParts(parts));
    const p = new GoogleGeminiProvider({ model: 'gemini-3-pro', client });
    const first = await p.complete('Refund ORD-1', undefined, { tools });
    const calls = first.toolCalls ?? [];
    await p.complete(
      [
        { role: 'user', content: 'Refund ORD-1' },
        { role: 'assistant', content: first.text, toolCalls: calls },
        {
          role: 'tool',
          results: calls.map((c) => ({ callId: c.id ?? '', name: c.name, content: '{}' })),
        },
      ],
      undefined,
      { tools },
    );
    return { calls, modelTurn: generateContent.mock.calls[1][0].contents[1] };
  }

  it('captures a functionCall part\'s thoughtSignature and sends it back on the same part', async () => {
    const { calls, modelTurn } = await twoSteps([
      { functionCall: { name: 'get_order', args: { id: 'ORD-1' } }, thoughtSignature: 'SIG123' },
    ]);
    expect(calls).toEqual([
      {
        id: 'call_1',
        name: 'get_order',
        arguments: { id: 'ORD-1' },
        providerMeta: { thoughtSignature: 'SIG123' },
      },
    ]);
    expect(modelTurn).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'get_order', args: { id: 'ORD-1' } }, thoughtSignature: 'SIG123' }],
    });
  });

  it('keeps parallel calls apart: only the first part carries the signature', async () => {
    const { calls, modelTurn } = await twoSteps([
      { functionCall: { name: 'get_order', args: { id: 'A' } }, thoughtSignature: 'SIG123' },
      { functionCall: { name: 'get_order', args: { id: 'B' } } },
    ]);
    expect(calls[1]).not.toHaveProperty('providerMeta');
    expect(modelTurn.parts).toEqual([
      { functionCall: { name: 'get_order', args: { id: 'A' } }, thoughtSignature: 'SIG123' },
      { functionCall: { name: 'get_order', args: { id: 'B' } } },
    ]);
  });

  it('sends no signature when Gemini gave none', async () => {
    const { calls, modelTurn } = await twoSteps([{ functionCall: { name: 'get_order', args: {} } }]);
    expect(calls[0]).not.toHaveProperty('providerMeta');
    expect(modelTurn.parts).toEqual([{ functionCall: { name: 'get_order', args: {} } }]);
  });
});
