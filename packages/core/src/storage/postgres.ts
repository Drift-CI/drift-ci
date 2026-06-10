import type { RunResult } from '../types/index.js';
import type { RunFilter, StorageAdapter } from './interface.js';

// The `postgres` package is an optional peer dep — pinned by
// @drift-ci/dashboard (which always needs it) and declared optional on
// @drift-ci/core (CLI users on SQLite don't need it to ship). We import
// it dynamically with a /* webpackIgnore */ hint so ncc doesn't hoist
// it into a static top-of-bundle import in the GitHub Action, matching
// the SQLiteStorage pattern.

interface SqlOptions {
  max?: number;
  prepare?: boolean;
}

type SqlTag = <T = unknown>(
  template: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

interface SqlLike {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  unsafe<T = unknown>(query: string, values?: unknown[]): Promise<T[]>;
  begin<T>(fn: (sql: SqlLike) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
}

type PostgresCtor = (url: string, options?: SqlOptions) => SqlLike;

export async function loadPostgresCtor(): Promise<PostgresCtor> {
  try {
    const mod = (await import(/* webpackIgnore: true */ 'postgres')) as unknown as {
      default?: PostgresCtor;
    };
    const ctor = mod.default ?? (mod as unknown as PostgresCtor);
    if (typeof ctor !== 'function') {
      throw new Error('postgres module did not expose a callable export');
    }
    return ctor;
  } catch (err) {
    throw new Error(
      `drift-ci: postgres storage requires the 'postgres' package. Install it with ` +
        `'pnpm add postgres'. Original error: ${(err as Error).message}`,
    );
  }
}

export interface PostgresStorageConfig {
  url: string;
  /** Inject a pre-built sql tag (tests + dashboard re-using its own client). */
  sql?: SqlLike;
  /** Max concurrent connections in the pool. Default 10. */
  max?: number;
}

export class PostgresStorage implements StorageAdapter {
  private constructor(
    private readonly sql: SqlLike,
    private readonly ownedConnection: boolean,
  ) {}

  static async open(config: PostgresStorageConfig): Promise<PostgresStorage> {
    if (config.sql) {
      return new PostgresStorage(config.sql, false);
    }
    const ctor = await loadPostgresCtor();
    const sql = ctor(config.url, { max: config.max ?? 10, prepare: false });
    return new PostgresStorage(sql, true);
  }

  async saveRun(run: RunResult): Promise<void> {
    const data = JSON.stringify(run);
    // ON CONFLICT (id) DO NOTHING makes ingest idempotent: re-sending the
    // same run is a no-op, not an UPDATE that would rewrite history.
    await (this.sql as unknown as SqlTag)`
      INSERT INTO runs (id, suite_id, provider, started_at, completed_at, data)
      VALUES (
        ${run.id},
        ${run.suiteId},
        ${run.provider},
        ${run.startedAt.toISOString()},
        ${run.completedAt.toISOString()},
        ${data}::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async getRun(id: string): Promise<RunResult | null> {
    const rows = (await (this.sql as unknown as SqlTag)<{ data: unknown }>`
      SELECT data FROM runs WHERE id = ${id}
    `);
    const first = rows[0];
    return first ? deserialise(first.data) : null;
  }

  async getMostRecentRun(suiteId?: string): Promise<RunResult | null> {
    const rows = suiteId
      ? await (this.sql as unknown as SqlTag)<{ data: unknown }>`
          SELECT data FROM runs
          WHERE suite_id = ${suiteId}
          ORDER BY started_at DESC
          LIMIT 1
        `
      : await (this.sql as unknown as SqlTag)<{ data: unknown }>`
          SELECT data FROM runs
          ORDER BY started_at DESC
          LIMIT 1
        `;
    const first = rows[0];
    return first ? deserialise(first.data) : null;
  }

  async listRuns(filter?: RunFilter): Promise<RunResult[]> {
    const suiteId = filter?.suiteId;
    const limit = filter?.limit ?? 100;
    const rows = suiteId
      ? await (this.sql as unknown as SqlTag)<{ data: unknown }>`
          SELECT data FROM runs
          WHERE suite_id = ${suiteId}
          ORDER BY started_at DESC
          LIMIT ${limit}
        `
      : await (this.sql as unknown as SqlTag)<{ data: unknown }>`
          SELECT data FROM runs
          ORDER BY started_at DESC
          LIMIT ${limit}
        `;
    return rows.map((r) => deserialise(r.data));
  }

  async close(): Promise<void> {
    if (this.ownedConnection) {
      await this.sql.end({ timeout: 5 });
    }
  }
}

function deserialise(data: unknown): RunResult {
  const raw =
    typeof data === 'string' ? (JSON.parse(data) as RunResult) : (data as RunResult);
  return {
    ...raw,
    startedAt: new Date(raw.startedAt),
    completedAt: new Date(raw.completedAt),
  };
}
