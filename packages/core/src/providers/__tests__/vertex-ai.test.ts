import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

import { VertexAIProvider } from '../vertex-ai.js';
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

describe('VertexAIProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GCP_PROJECT;
    delete process.env.GCP_LOCATION;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when project is not provided (no env, no config)', () => {
    expect(
      () => new VertexAIProvider({ model: 'gemini-2.5-pro', location: 'us-central1' }),
    ).toThrowError(/project is required/);
  });

  it('throws when location is not provided (no env, no config)', () => {
    expect(
      () => new VertexAIProvider({ model: 'gemini-2.5-pro', project: 'my-proj' }),
    ).toThrowError(/location is required/);
  });

  it('reads project / location from GOOGLE_CLOUD_* env when not in config', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'my-proj';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';
    // We expect construction to succeed (no client injection — tests
    // that the env path runs through buildVertexClient without
    // throwing for missing creds, since the SDK ctor is lazy).
    expect(
      () => new VertexAIProvider({ model: 'gemini-2.5-pro' }),
    ).not.toThrow();
  });

  it('also accepts the legacy GCP_PROJECT / GCP_LOCATION env names', () => {
    process.env.GCP_PROJECT = 'my-proj';
    process.env.GCP_LOCATION = 'us-central1';
    expect(
      () => new VertexAIProvider({ model: 'gemini-2.5-pro' }),
    ).not.toThrow();
  });

  it('names itself `vertex/<model>` (distinct from google/<model>)', () => {
    const { client } = makeClient();
    const p = new VertexAIProvider({
      model: 'gemini-2.5-pro',
      project: 'p',
      location: 'us-central1',
      client,
    });
    expect(p.name).toBe('vertex/gemini-2.5-pro');
  });

  it('forwards the request through the injected client (no SDK ctor)', async () => {
    const { client, generateContent } = makeClient();
    const p = new VertexAIProvider({
      model: 'gemini-2.5-flash',
      project: 'p',
      location: 'us-central1',
      client,
    });
    await p.complete('hello', 'be brief');
    const args = generateContent.mock.calls[0][0];
    expect(args.model).toBe('gemini-2.5-flash');
    expect(args.contents).toEqual([
      { role: 'user', parts: [{ text: 'hello' }] },
    ]);
    expect(args.config.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'be brief' }],
    });
  });

  it('extracts text and usage metadata identically to the Gemini provider', async () => {
    const { client } = makeClient();
    const p = new VertexAIProvider({
      model: 'gemini-2.5-pro',
      project: 'p',
      location: 'us-central1',
      client,
    });
    const out = await p.complete('q');
    expect(out.text).toBe('hi');
    expect(out.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 3,
      totalTokens: 15,
    });
    expect(out.model).toBe('gemini-2.5-pro-001');
  });

  it('respects defaultMaxTokens and option overrides', async () => {
    const { client, generateContent } = makeClient();
    const p = new VertexAIProvider({
      model: 'x',
      project: 'p',
      location: 'us-central1',
      client,
      defaultMaxTokens: 250,
    });
    await p.complete('q');
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(250);
    generateContent.mockClear();
    await p.complete('q', undefined, { maxTokens: 999 });
    expect(generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(999);
  });

  it('rebrands assistant turns as Gemini `model` role', async () => {
    const { client, generateContent } = makeClient();
    const p = new VertexAIProvider({
      model: 'x',
      project: 'p',
      location: 'us-central1',
      client,
    });
    await p.complete([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
    ]);
    const sent = generateContent.mock.calls[0][0].contents;
    expect(sent[1]).toEqual({ role: 'model', parts: [{ text: 'hey' }] });
  });

  it('retries on 429 via withRetry then succeeds', async () => {
    const calls: unknown[] = [];
    const generateContent = vi.fn().mockImplementation(() => {
      calls.push(null);
      if (calls.length === 1) {
        const err = new Error('quota') as Error & { status: number };
        err.status = 429;
        return Promise.reject(err);
      }
      return Promise.resolve(okResponse());
    });
    const p = new VertexAIProvider({
      model: 'x',
      project: 'p',
      location: 'us-central1',
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
    const err = new Error('forbidden') as Error & { status: number };
    err.status = 403;
    const generateContent = vi.fn().mockRejectedValue(err);
    const p = new VertexAIProvider({
      model: 'x',
      project: 'p',
      location: 'us-central1',
      client: { models: { generateContent } } as GoogleGenAILike,
      retry: { maxRetries: 0 },
    });
    await expect(p.complete('q')).rejects.toThrow(/forbidden/);
  });
});
