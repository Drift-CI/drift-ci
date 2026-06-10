import type { RunResult, Suite } from '../types/index.js';
import { computeSuiteHash } from '../engine/baseline.js';
import type { RunFilter, StorageAdapter } from './interface.js';

/**
 * Snapshot of everything the dashboard receiver needs to hydrate
 * `baseline_snapshots` rows that the raw `RunResult` envelope doesn't
 * carry. Built once per run by {@link buildIngestContext} and stuffed
 * into the HttpStorage constructor so `saveRun` can forward the
 * enriched payload without re-touching the suite on every call.
 */
export interface IngestContext {
  /** Per-case `suiteHash` keyed by case id. */
  suiteHashes: Record<string, string>;
  /** Optional judge-provider hash (null when the suite has no llm-judge). */
  judgeHash?: string;
}

/**
 * Pure helper: derives an {@link IngestContext} from a Suite + optional
 * judgeHash. Safe to call with a half-populated suite — any missing
 * cases simply don't appear in the output map.
 */
export function buildIngestContext(
  suite: Suite,
  judgeHash?: string,
): IngestContext {
  const suiteHashes: Record<string, string> = {};
  for (const tc of suite.cases) {
    suiteHashes[tc.id] = computeSuiteHash(tc);
  }
  return { suiteHashes, judgeHash };
}

export interface HttpStorageConfig {
  url: string;
  token?: string;
  /** Runtime context the receiver uses to populate baseline_snapshots. */
  context?: IngestContext;
  /** Injectable fetch for unit tests. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Request timeout in ms. Default 30_000. */
  timeoutMs?: number;
}

export interface IngestRequestBody {
  /** Schema version of the ingest envelope. */
  schemaVersion: 1;
  run: RunResult;
  context?: IngestContext;
}

const INGEST_SCHEMA_VERSION = 1 as const;

export class HttpStorage implements StorageAdapter {
  private readonly url: string;
  private readonly token?: string;
  private readonly context?: IngestContext;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: HttpStorageConfig) {
    if (!config.url) {
      throw new Error('HttpStorage: `url` is required.');
    }
    this.url = config.url.replace(/\/+$/, '');
    this.token = config.token;
    this.context = config.context;
    this.fetchImpl = config.fetch ?? globalThis.fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error(
        'HttpStorage: global fetch is not available; pass config.fetch (Node 18+ has native fetch).',
      );
    }
  }

  async saveRun(run: RunResult): Promise<void> {
    const body: IngestRequestBody = {
      schemaVersion: INGEST_SCHEMA_VERSION,
      run,
      context: this.context,
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'drift-ci/http-storage',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.url}/api/v1/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const snippet = await safeReadText(res);
        throw new Error(
          `HttpStorage: ingest failed ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async getRun(id: string): Promise<RunResult | null> {
    const res = await this.fetchJson(
      `${this.url}/api/v1/runs/${encodeURIComponent(id)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      const snippet = await safeReadText(res);
      throw new Error(
        `HttpStorage: getRun failed ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`,
      );
    }
    const body = (await res.json()) as { run: SerialisedRunResponse };
    return reviveRun(body.run);
  }

  async getMostRecentRun(suiteId?: string): Promise<RunResult | null> {
    const url = new URL(`${this.url}/api/v1/runs`);
    if (suiteId) url.searchParams.set('suiteId', suiteId);
    url.searchParams.set('limit', '1');
    const res = await this.fetchJson(url.toString());
    if (!res.ok) {
      const snippet = await safeReadText(res);
      throw new Error(
        `HttpStorage: getMostRecentRun failed ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`,
      );
    }
    const body = (await res.json()) as { runs: SerialisedRunResponse[] };
    if (!body.runs?.length) return null;
    // The list endpoint returns envelope-only rows. Resolve to the full
    // run via getRun so dashboards and CLI tooling get a consistent
    // shape (with the embedded `data.cases[]` populated).
    return this.getRun(body.runs[0].id);
  }

  async listRuns(filter?: RunFilter): Promise<RunResult[]> {
    const url = new URL(`${this.url}/api/v1/runs`);
    if (filter?.suiteId) url.searchParams.set('suiteId', filter.suiteId);
    if (typeof filter?.limit === 'number') {
      url.searchParams.set('limit', String(filter.limit));
    }
    const res = await this.fetchJson(url.toString());
    if (!res.ok) {
      const snippet = await safeReadText(res);
      throw new Error(
        `HttpStorage: listRuns failed ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''}`,
      );
    }
    const body = (await res.json()) as { runs: SerialisedRunResponse[] };
    if (!body.runs?.length) return [];
    return Promise.all(body.runs.map((r) => this.getRun(r.id) as Promise<RunResult>));
  }

  private async fetchJson(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'drift-ci/http-storage',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        headers,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    // No persistent state.
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 400 ? text.slice(0, 400) + '…' : text;
  } catch {
    /* c8 ignore next */
    return '';
  }
}

/** Wire shape returned by the dashboard's GET /api/v1/runs/* endpoints. */
interface SerialisedRunResponse {
  id: string;
  suiteId: string;
  provider: string;
  startedAt: string;
  completedAt: string;
  receivedAt?: string;
  data?: unknown;
}

function reviveRun(payload: SerialisedRunResponse): RunResult {
  // The receiver round-trips the original RunResult under `data` for
  // back-compat with PostgresStorage / SQLiteStorage. Prefer that when
  // present; fall back to building a stub from the envelope so the
  // CLI/agents can at least see id+suite+provider when no `data` is
  // shipped (older receivers).
  if (payload.data && typeof payload.data === 'object') {
    const raw = payload.data as RunResult;
    return {
      ...raw,
      startedAt: new Date(raw.startedAt),
      completedAt: new Date(raw.completedAt),
    };
  }
  /* c8 ignore start -- legacy fallback for envelope-only servers. */
  return {
    id: payload.id,
    suiteId: payload.suiteId,
    provider: payload.provider,
    startedAt: new Date(payload.startedAt),
    completedAt: new Date(payload.completedAt),
    cases: [],
    summary: {
      total: 0,
      passed: 0,
      transient: 0,
      evaluatorErrors: 0,
      failed: 0,
      regressions: 0,
      avgScore: 0,
      avgLatencyMs: 0,
    },
  };
  /* c8 ignore stop */
}

export { INGEST_SCHEMA_VERSION };
