import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockProvider } from '../mock.js';
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
