import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '../ollama.js';

function makeFetchResponse(body: unknown, init: Partial<ResponseInit> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    model: 'llama3.2',
    message: { role: 'assistant', content: 'hi' },
    done: true,
    prompt_eval_count: 12,
    eval_count: 3,
    ...overrides,
  };
}

describe('OllamaProvider', () => {
  it('posts to {baseURL}/api/chat with model + messages + stream:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(okBody()));
    const p = new OllamaProvider({
      model: 'llama3.2',
      baseURL: 'http://ollama.test:11434',
      fetch: fetchMock,
    });
    await p.complete('hello');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ollama.test:11434/api/chat');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('llama3.2');
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('defaults baseURL to localhost:11434', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(okBody()));
    const p = new OllamaProvider({ model: 'x', fetch: fetchMock });
    await p.complete('hi');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/chat');
  });

  it('strips trailing slashes from baseURL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(okBody()));
    const p = new OllamaProvider({
      model: 'x',
      baseURL: 'https://ollama.com///',
      fetch: fetchMock,
    });
    await p.complete('hi');
    expect(fetchMock.mock.calls[0][0]).toBe('https://ollama.com/api/chat');
  });

  it('prepends a system message when systemPrompt is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(okBody()));
    const p = new OllamaProvider({ model: 'x', fetch: fetchMock });
    await p.complete('user turn', 'you are a frog');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toEqual([
      { role: 'system', content: 'you are a frog' },
      { role: 'user', content: 'user turn' },
    ]);
  });

  it('sends Authorization header when apiKey is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(okBody()));
    const p = new OllamaProvider({
      model: 'x',
      baseURL: 'https://ollama.com',
      apiKey: 'secret-key',
      fetch: fetchMock,
    });
    await p.complete('hi');
    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
  });

  it('does not send Authorization header when apiKey absent and env unset', async () => {
    const originalEnv = process.env.OLLAMA_API_KEY;
    delete process.env.OLLAMA_API_KEY;
    try {
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(okBody()));
      const p = new OllamaProvider({ model: 'x', fetch: fetchMock });
      await p.complete('hi');
      const headers = (fetchMock.mock.calls[0][1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    } finally {
      if (originalEnv !== undefined) process.env.OLLAMA_API_KEY = originalEnv;
    }
  });

  it('falls back to OLLAMA_API_KEY env var when apiKey absent', async () => {
    const originalEnv = process.env.OLLAMA_API_KEY;
    process.env.OLLAMA_API_KEY = 'env-key';
    try {
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(okBody()));
      const p = new OllamaProvider({ model: 'x', fetch: fetchMock });
      await p.complete('hi');
      const headers = (fetchMock.mock.calls[0][1] as RequestInit)
        .headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer env-key');
    } finally {
      if (originalEnv === undefined) delete process.env.OLLAMA_API_KEY;
      else process.env.OLLAMA_API_KEY = originalEnv;
    }
  });

  it('parses text, usage counts, and model from the chat response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeFetchResponse(
        okBody({
          model: 'llama3.2:3b',
          message: { role: 'assistant', content: 'hello world' },
          prompt_eval_count: 25,
          eval_count: 7,
        }),
      ),
    );
    const p = new OllamaProvider({ model: 'llama3.2', fetch: fetchMock });
    const out = await p.complete('q');
    expect(out.text).toBe('hello world');
    expect(out.model).toBe('llama3.2:3b');
    expect(out.usage).toEqual({
      inputTokens: 25,
      outputTokens: 7,
      totalTokens: 32,
    });
    expect(typeof out.latencyMs).toBe('number');
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('throws with status on non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('nope', { status: 500, statusText: 'Internal Error' }),
    );
    const p = new OllamaProvider({
      model: 'x',
      fetch: fetchMock,
      retry: { maxRetries: 0 },
    });
    await expect(p.complete('hi')).rejects.toMatchObject({
      message: expect.stringContaining('500'),
      status: 500,
    });
  });

  it('retries on 429 via withRetry and eventually succeeds', async () => {
    const responses: Response[] = [
      new Response('slow', { status: 429, statusText: 'Too Many' }),
      makeFetchResponse(okBody({ message: { role: 'assistant', content: 'ok' } })),
    ];
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(responses.shift()!));
    const p = new OllamaProvider({
      model: 'x',
      fetch: fetchMock,
      retry: {
        maxRetries: 2,
        initialDelayMs: 0,
        jitterMs: 0,
        sleep: () => Promise.resolve(),
      },
    });
    const out = await p.complete('hi');
    expect(out.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports name as ollama/<model>', () => {
    const p = new OllamaProvider({ model: 'llama3.2', fetch: vi.fn() });
    expect(p.name).toBe('ollama/llama3.2');
  });
});
