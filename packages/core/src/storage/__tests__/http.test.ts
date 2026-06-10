import { describe, it, expect, vi } from 'vitest';

import { HttpStorage, buildIngestContext } from '../http.js';
import type { RunResult, Suite } from '../../types/index.js';

function makeRun(overrides: Partial<RunResult> = {}): RunResult {
  return {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    suiteId: 'test-suite',
    provider: 'mock/m',
    startedAt: new Date('2026-04-25T00:00:00Z'),
    completedAt: new Date('2026-04-25T00:00:05Z'),
    cases: [
      {
        caseId: 'c1',
        runId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        output: 'a',
        score: 1,
        threshold: 0.1,
        latencyMs: 10,
        status: 'pass',
      },
    ],
    summary: {
      total: 1,
      passed: 1,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 1,
      avgLatencyMs: 10,
    },
    ...overrides,
  };
}

function makeSuite(): Suite {
  return {
    version: 1,
    id: 'test-suite',
    name: 'Test',
    cases: [
      { id: 'c1', input: 'q1', expected: 'a' },
      { id: 'c2', input: 'q2', expected: 'b' },
    ],
  };
}

describe('buildIngestContext', () => {
  it('hashes every case in the suite', () => {
    const ctx = buildIngestContext(makeSuite());
    expect(Object.keys(ctx.suiteHashes).sort()).toEqual(['c1', 'c2']);
    expect(ctx.suiteHashes.c1.startsWith('sha256:')).toBe(true);
    expect(ctx.suiteHashes.c1).not.toBe(ctx.suiteHashes.c2);
  });

  it('carries an explicit judgeHash when provided', () => {
    const ctx = buildIngestContext(makeSuite(), 'sha256:abc123');
    expect(ctx.judgeHash).toBe('sha256:abc123');
  });

  it('leaves judgeHash undefined when omitted', () => {
    const ctx = buildIngestContext(makeSuite());
    expect(ctx.judgeHash).toBeUndefined();
  });

  it('is deterministic across calls for the same suite', () => {
    const suite = makeSuite();
    expect(buildIngestContext(suite).suiteHashes).toEqual(
      buildIngestContext(suite).suiteHashes,
    );
  });
});

describe('HttpStorage', () => {
  const URL = 'https://dash.example';

  it('rejects construction without a url', () => {
    expect(() => new HttpStorage({ url: '' })).toThrowError(/url/);
  });

  it('strips trailing slashes from the base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const s = new HttpStorage({ url: 'https://dash.example///', fetch: fetchMock });
    await s.saveRun(makeRun());
    expect(fetchMock.mock.calls[0][0]).toBe('https://dash.example/api/v1/runs');
  });

  it('POSTs to /api/v1/runs with the ingest envelope', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const ctx = buildIngestContext(makeSuite());
    const s = new HttpStorage({ url: URL, token: 'tok', context: ctx, fetch: fetchMock });
    await s.saveRun(makeRun());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL}/api/v1/runs`);
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.schemaVersion).toBe(1);
    expect(body.run.id).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(body.context.suiteHashes.c1).toMatch(/^sha256:/);
  });

  it('adds Authorization: Bearer when token is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const s = new HttpStorage({ url: URL, token: 'secret-tok', fetch: fetchMock });
    await s.saveRun(makeRun());
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-tok');
  });

  it('omits Authorization when no token is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const s = new HttpStorage({ url: URL, fetch: fetchMock });
    await s.saveRun(makeRun());
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws a descriptive error on non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('db is sleeping', { status: 503, statusText: 'Service Unavailable' }),
    );
    const s = new HttpStorage({ url: URL, fetch: fetchMock });
    await expect(s.saveRun(makeRun())).rejects.toThrow(/ingest failed 503.*sleeping/);
  });

  describe('getRun', () => {
    it('issues GET /api/v1/runs/:id with the bearer token', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            run: {
              id: 'abc',
              suiteId: 's',
              provider: 'mock/m',
              startedAt: '2026-04-25T00:00:00.000Z',
              completedAt: '2026-04-25T00:00:01.000Z',
              data: makeRun({ id: 'abc' }),
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
      const s = new HttpStorage({ url: URL, token: 'tok', fetch: fetchMock });
      const out = await s.getRun('abc');
      expect(out).not.toBeNull();
      expect(out!.id).toBe('abc');
      expect(out!.startedAt).toBeInstanceOf(Date);
      const [reqUrl, init] = fetchMock.mock.calls[0];
      expect(reqUrl).toBe(`${URL}/api/v1/runs/abc`);
      expect((init as RequestInit).method).toBe('GET');
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok');
    });

    it('returns null on 404', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      expect(await s.getRun('missing')).toBeNull();
    });

    it('throws on other non-2xx', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('boom', { status: 500, statusText: 'Server Error' }),
      );
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      await expect(s.getRun('x')).rejects.toThrow(/getRun failed 500.*boom/);
    });
  });

  describe('getMostRecentRun', () => {
    it('lists with limit=1 and resolves the first id via getRun', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('?') && url.includes('limit=1')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, runs: [{ id: 'most-recent' }] }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              run: {
                id: 'most-recent',
                suiteId: 's',
                provider: 'mock/m',
                startedAt: '2026-04-25T00:00:00.000Z',
                completedAt: '2026-04-25T00:00:01.000Z',
                data: makeRun({ id: 'most-recent' }),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      });
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      const out = await s.getMostRecentRun();
      expect(out!.id).toBe('most-recent');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('passes suiteId through as a query param', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, runs: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      await s.getMostRecentRun('suite-x');
      expect(fetchMock.mock.calls[0][0]).toContain('suiteId=suite-x');
    });

    it('returns null when no runs match', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, runs: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      expect(await s.getMostRecentRun()).toBeNull();
    });

    it('throws on a non-2xx list response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('down', { status: 502, statusText: 'Bad Gateway' }),
      );
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      await expect(s.getMostRecentRun()).rejects.toThrow(/getMostRecentRun failed 502/);
    });
  });

  describe('listRuns', () => {
    it('passes filter.suiteId + limit and hydrates each id', async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url.includes('?')) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ok: true, runs: [{ id: 'a' }, { id: 'b' }] }),
              { status: 200, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        const id = url.split('/').pop()!;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: true,
              run: {
                id,
                suiteId: 's',
                provider: 'mock/m',
                startedAt: '2026-04-25T00:00:00.000Z',
                completedAt: '2026-04-25T00:00:01.000Z',
                data: makeRun({ id }),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      });
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      const rows = await s.listRuns({ suiteId: 's', limit: 5 });
      expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
      expect(fetchMock.mock.calls[0][0]).toContain('suiteId=s');
      expect(fetchMock.mock.calls[0][0]).toContain('limit=5');
    });

    it('returns an empty array when the list endpoint returns no runs', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, runs: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      expect(await s.listRuns()).toEqual([]);
    });

    it('throws on a non-2xx list response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('nope', { status: 503 }),
      );
      const s = new HttpStorage({ url: URL, fetch: fetchMock });
      await expect(s.listRuns()).rejects.toThrow(/listRuns failed 503/);
    });
  });

  it('close is a no-op', async () => {
    const s = new HttpStorage({ url: URL, fetch: vi.fn() });
    await expect(s.close()).resolves.toBeUndefined();
  });

  it('aborts the request after timeoutMs', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        (init.signal as AbortSignal).addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const s = new HttpStorage({ url: URL, fetch: fetchMock, timeoutMs: 10 });
    await expect(s.saveRun(makeRun())).rejects.toThrow();
  });
});
