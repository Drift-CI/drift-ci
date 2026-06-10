import { describe, it, expect, vi } from 'vitest';

import { GoogleGeminiProvider } from '../google-gemini.js';
import type { GoogleGenAILike } from '../google-base.js';

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
