import { describe, it, expect, vi } from 'vitest';

import {
  LLAMA_GUARD_PROMPT,
  LlamaGuardClassifier,
  OPENAI_MODERATIONS_URL,
  OpenAIModerationClassifier,
  SafetyClassifierEvaluator,
  parseLlamaGuardResponse,
  type SafetyClassifier,
  type SafetyResult,
} from '../safety-classifier.js';
import { createEvaluatorChain } from '../factory.js';
import type { ProviderAdapter, CompletionResponse } from '../../providers/base.js';

// ─── helpers ────────────────────────────────────────────────────────────

const baseInput = {
  input: 'q',
  output: 'some candidate response',
  expected: undefined as string | undefined,
};

class StubClassifier implements SafetyClassifier {
  readonly name: string;
  classify = vi.fn<[string], Promise<SafetyResult>>();

  constructor(name: string, public stub: () => SafetyResult) {
    this.name = name;
    this.classify = vi.fn(async () => this.stub());
  }
}

class StubProvider implements ProviderAdapter {
  readonly name: string;
  complete = vi.fn<unknown[], Promise<CompletionResponse>>();

  constructor(name: string, response: () => string) {
    this.name = name;
    this.complete = vi.fn(async () => ({
      text: response(),
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      model: name,
      latencyMs: 1,
    }));
  }
}

function captureFetch(response: Response = new Response('{}', { status: 200 })) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

function moderationResponse(opts: {
  flagged: boolean;
  categories?: Record<string, boolean>;
  scores?: Record<string, number>;
}): Response {
  return new Response(
    JSON.stringify({
      results: [
        {
          flagged: opts.flagged,
          categories: opts.categories ?? {},
          category_scores: opts.scores ?? {},
        },
      ],
    }),
    { status: 200 },
  );
}

// ─── SafetyClassifierEvaluator ──────────────────────────────────────────

describe('SafetyClassifierEvaluator', () => {
  it('returns score 1 with reason "safe" when classifier says safe', async () => {
    const classifier = new StubClassifier('test', () => ({
      safe: true,
      flagged: [],
      classifier: 'test',
    }));
    const ev = new SafetyClassifierEvaluator({ classifier });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBe(1);
    expect(out.reason).toBe('safe');
    expect(classifier.classify).toHaveBeenCalledWith('some candidate response');
  });

  it('returns score 0 with the flagged categories in reason when unsafe', async () => {
    const classifier = new StubClassifier('test', () => ({
      safe: false,
      flagged: ['hate', 'violence'],
      classifier: 'test',
    }));
    const ev = new SafetyClassifierEvaluator({ classifier });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBe(0);
    expect(out.reason).toBe('flagged: hate, violence');
  });

  it('honours blockedCategories — non-matching flagged cats do NOT fail the case', async () => {
    const classifier = new StubClassifier('test', () => ({
      safe: false,
      flagged: ['harassment'],
      classifier: 'test',
    }));
    const ev = new SafetyClassifierEvaluator({
      classifier,
      blockedCategories: ['hate', 'violence'],
    });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBe(1);
    expect(out.reason).toBe('safe');
    // Original flag still surfaces in metadata for visibility.
    const meta = out.metadata as Record<string, unknown>;
    expect(meta.flagged).toEqual(['harassment']);
    expect(meta.failing).toEqual([]);
  });

  it('treats blockedCategories as the failure whitelist (matching flag fails the case)', async () => {
    const classifier = new StubClassifier('test', () => ({
      safe: false,
      flagged: ['harassment', 'hate'],
      classifier: 'test',
    }));
    const ev = new SafetyClassifierEvaluator({
      classifier,
      blockedCategories: ['hate'],
    });
    const out = await ev.evaluate({ ...baseInput });
    expect(out.score).toBe(0);
    expect(out.reason).toBe('flagged: hate');
  });

  it('passes through classifier name + per-category scores in metadata', async () => {
    const classifier = new StubClassifier('test', () => ({
      safe: false,
      flagged: ['hate'],
      scores: { hate: 0.92, violence: 0.04 },
      classifier: 'openai-moderation',
    }));
    const ev = new SafetyClassifierEvaluator({ classifier });
    const out = await ev.evaluate({ ...baseInput });
    const meta = out.metadata as Record<string, unknown>;
    expect(meta.classifier).toBe('openai-moderation');
    expect(meta.scores).toEqual({ hate: 0.92, violence: 0.04 });
    expect(meta.safe).toBe(false);
  });
});

// ─── OpenAIModerationClassifier ─────────────────────────────────────────

describe('OpenAIModerationClassifier', () => {
  it('throws when no apiKey + no env var is available', () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(() => new OpenAIModerationClassifier()).toThrow(
        /OPENAI_API_KEY/,
      );
    } finally {
      if (original !== undefined) process.env.OPENAI_API_KEY = original;
    }
  });

  it('POSTs to the moderations endpoint with Bearer auth and the model field', async () => {
    const { fetch, calls } = captureFetch(
      moderationResponse({ flagged: false, categories: {}, scores: {} }),
    );
    const c = new OpenAIModerationClassifier({ apiKey: 'sk-test', fetch });
    await c.classify('hello');
    expect(calls[0].url).toBe(OPENAI_MODERATIONS_URL);
    expect(calls[0].init?.method).toBe('POST');
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.model).toBe('omni-moderation-latest');
    expect(body.input).toBe('hello');
  });

  it('honours custom model + endpoint overrides', async () => {
    const { fetch, calls } = captureFetch(
      moderationResponse({ flagged: false }),
    );
    const c = new OpenAIModerationClassifier({
      apiKey: 'sk-test',
      fetch,
      model: 'text-moderation-stable',
      url: 'https://proxy.internal/v1/moderations',
    });
    await c.classify('hi');
    expect(calls[0].url).toBe('https://proxy.internal/v1/moderations');
    expect(JSON.parse(calls[0].init?.body as string).model).toBe(
      'text-moderation-stable',
    );
  });

  it('returns safe verdict when API says not flagged', async () => {
    const fetch = captureFetch(
      moderationResponse({
        flagged: false,
        categories: { hate: false, violence: false },
        scores: { hate: 0.01, violence: 0.02 },
      }),
    ).fetch;
    const c = new OpenAIModerationClassifier({ apiKey: 'sk-test', fetch });
    const out = await c.classify('hi');
    expect(out.safe).toBe(true);
    expect(out.flagged).toEqual([]);
    expect(out.scores).toEqual({ hate: 0.01, violence: 0.02 });
    expect(out.classifier).toBe('openai-moderation');
  });

  it('extracts only categories that are TRUE into the flagged list', async () => {
    const fetch = captureFetch(
      moderationResponse({
        flagged: true,
        categories: { hate: true, violence: false, harassment: true },
        scores: { hate: 0.91, violence: 0.04, harassment: 0.78 },
      }),
    ).fetch;
    const c = new OpenAIModerationClassifier({ apiKey: 'sk-test', fetch });
    const out = await c.classify('mean text');
    expect(out.safe).toBe(false);
    expect(out.flagged.sort()).toEqual(['harassment', 'hate']);
  });

  it('throws on non-2xx so the runner records a transient/evaluator error', async () => {
    const { fetch } = captureFetch(
      new Response('rate limited', { status: 429, statusText: 'Too Many Requests' }),
    );
    const c = new OpenAIModerationClassifier({
      apiKey: 'sk-test',
      fetch,
      retry: { maxRetries: 0 },
    });
    await expect(c.classify('x')).rejects.toThrow(/429/);
  });

  it('fails-safe to "unsafe + classifier-error" when results array is empty', async () => {
    const { fetch } = captureFetch(
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    const c = new OpenAIModerationClassifier({ apiKey: 'sk-test', fetch });
    const out = await c.classify('x');
    expect(out.safe).toBe(false);
    expect(out.flagged).toEqual(['classifier-error']);
  });

  it('retries on 429 via withRetry then succeeds', async () => {
    let calls = 0;
    const fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate', { status: 429, statusText: 'Too Many' });
      }
      return moderationResponse({ flagged: false });
    }) as unknown as typeof globalThis.fetch;

    const c = new OpenAIModerationClassifier({
      apiKey: 'sk-test',
      fetch,
      retry: {
        maxRetries: 2,
        initialDelayMs: 0,
        jitterMs: 0,
        sleep: () => Promise.resolve(),
      },
    });
    const out = await c.classify('x');
    expect(out.safe).toBe(true);
    expect(calls).toBe(2);
  });
});

// ─── LlamaGuardClassifier ───────────────────────────────────────────────

describe('LlamaGuardClassifier', () => {
  it('issues a single completion call carrying the LLAMA_GUARD_PROMPT body', async () => {
    const provider = new StubProvider('ollama/llama-guard-3-8b', () => 'safe');
    const c = new LlamaGuardClassifier({ provider });
    await c.classify('candidate text');
    expect(provider.complete).toHaveBeenCalledTimes(1);
    const args = provider.complete.mock.calls[0];
    expect(args[0]).toBe(LLAMA_GUARD_PROMPT('candidate text'));
    expect(args[2]).toEqual({ temperature: 0, maxTokens: 64 });
  });

  it('returns safe verdict on "safe" response', async () => {
    const provider = new StubProvider('ollama/llama-guard-3-8b', () => 'safe');
    const c = new LlamaGuardClassifier({ provider });
    const out = await c.classify('hi');
    expect(out.safe).toBe(true);
    expect(out.flagged).toEqual([]);
    expect(out.classifier).toBe('llama-guard');
  });

  it('returns unsafe verdict with parsed categories on "unsafe\\nS1,S10" response', async () => {
    const provider = new StubProvider(
      'ollama/llama-guard-3-8b',
      () => 'unsafe\nS1,S10',
    );
    const c = new LlamaGuardClassifier({ provider });
    const out = await c.classify('mean');
    expect(out.safe).toBe(false);
    expect(out.flagged).toEqual(['S1', 'S10']);
  });

  it('honours a custom prompt template', async () => {
    const provider = new StubProvider('p', () => 'safe');
    const custom = vi.fn((c: string) => `CUSTOM(${c})`);
    const cls = new LlamaGuardClassifier({ provider, promptTemplate: custom });
    await cls.classify('x');
    expect(custom).toHaveBeenCalledWith('x');
    expect(provider.complete.mock.calls[0][0]).toBe('CUSTOM(x)');
  });
});

describe('parseLlamaGuardResponse', () => {
  it('treats a leading "safe" as safe', () => {
    expect(parseLlamaGuardResponse('safe')).toMatchObject({
      safe: true,
      flagged: [],
    });
  });

  it('is case-insensitive on the verdict line', () => {
    expect(parseLlamaGuardResponse('SAFE')).toMatchObject({ safe: true });
    expect(parseLlamaGuardResponse('UNSAFE')).toMatchObject({ safe: false });
  });

  it('parses unsafe with no categories as flagged: ["unspecified"]', () => {
    expect(parseLlamaGuardResponse('unsafe')).toMatchObject({
      safe: false,
      flagged: ['unspecified'],
    });
  });

  it('parses comma-separated category codes on the second line', () => {
    expect(parseLlamaGuardResponse('unsafe\nS1, S2 ,S10')).toMatchObject({
      safe: false,
      flagged: ['S1', 'S2', 'S10'],
    });
  });

  it('falls back to "classifier-error" on unparseable verdict (fail-safe to unsafe)', () => {
    expect(parseLlamaGuardResponse('I do not know.')).toMatchObject({
      safe: false,
      flagged: ['classifier-error'],
    });
  });

  it('falls back to "classifier-error" on empty response', () => {
    expect(parseLlamaGuardResponse('   \n  ')).toMatchObject({
      safe: false,
      flagged: ['classifier-error'],
    });
  });
});

// ─── factory wiring ─────────────────────────────────────────────────────

describe('createEvaluatorChain — safety-classifier', () => {
  function testProvider(): ProviderAdapter {
    return new StubProvider('test/x', () => '');
  }

  it('throws when safety-classifier is requested but no classifier is configured', () => {
    expect(() =>
      createEvaluatorChain(['safety-classifier'], {
        testProvider: testProvider(),
      }),
    ).toThrow(/safety-classifier evaluator requires/);
  });

  it('builds successfully with a configured classifier', () => {
    const classifier: SafetyClassifier = {
      name: 'stub',
      classify: vi.fn(async () => ({
        safe: true,
        flagged: [],
        classifier: 'stub',
      })),
    };
    expect(() =>
      createEvaluatorChain(['safety-classifier'], {
        testProvider: testProvider(),
        safetyClassifier: classifier,
      }),
    ).not.toThrow();
  });

  it('threads safetyBlockedCategories through to the evaluator', async () => {
    const stub = vi.fn(async () => ({
      safe: false,
      flagged: ['harassment'],
      classifier: 'stub',
    }));
    const classifier: SafetyClassifier = { name: 'stub', classify: stub };
    const chain = createEvaluatorChain(['safety-classifier'], {
      testProvider: testProvider(),
      safetyClassifier: classifier,
      safetyBlockedCategories: ['hate'], // harassment is NOT in the block list
    });
    const out = await chain.evaluate({
      input: 'q',
      output: 'a',
    });
    expect(out.score).toBe(1); // harassment doesn't fail under this whitelist
  });
});
