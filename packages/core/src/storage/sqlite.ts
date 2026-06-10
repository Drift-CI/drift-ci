import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

import type { RunResult } from '../types/index.js';
import type { RunFilter, StorageAdapter } from './interface.js';

type BetterSqliteDatabase = {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
  pragma(pragma: string): unknown;
  close(): void;
};

type BetterSqliteCtor = new (
  path: string,
  options?: { fileMustExist?: boolean; readonly?: boolean },
) => BetterSqliteDatabase;

interface SerialisedRunRow {
  id: string;
  suite_id: string;
  provider: string;
  started_at: string;
  completed_at: string;
  data: string;
}

export const SQLITE_SCHEMA_VERSION = 1;

export async function loadBetterSqliteCtor(): Promise<BetterSqliteCtor> {
  // /* webpackIgnore: true */ keeps @vercel/ncc from hoisting this
  // dynamic import into a static `import "better-sqlite3"` at the top of
  // the bundled action. With the hint, ncc leaves the call alone and the
  // Action stays SQLite-free at runtime.
  try {
    const mod = (await import(/* webpackIgnore: true */ 'better-sqlite3')) as unknown as {
      default?: BetterSqliteCtor;
    };
    const ctor = mod.default ?? (mod as unknown as BetterSqliteCtor);
    if (typeof ctor !== 'function') {
      throw new Error('better-sqlite3 module did not expose a constructor');
    }
    return ctor;
  } catch (err) {
    throw new Error(
      `drift-ci: sqlite storage requires 'better-sqlite3'. Install it with ` +
        `'pnpm add better-sqlite3' (or 'npm i better-sqlite3'). ` +
        `Original error: ${(err as Error).message}`,
    );
  }
}

export class SQLiteStorage implements StorageAdapter {
  private constructor(
    private readonly db: BetterSqliteDatabase,
    public readonly path: string,
  ) {}

  static async open(dbPath = '.drift/db.sqlite'): Promise<SQLiteStorage> {
    const resolved = resolve(dbPath);
    mkdirSync(dirname(resolved), { recursive: true });
    const Ctor = await loadBetterSqliteCtor();
    const db = new Ctor(resolved);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return new SQLiteStorage(db, resolved);
  }

  async saveRun(run: RunResult): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO runs (id, suite_id, provider, started_at, completed_at, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.suiteId,
        run.provider,
        run.startedAt.toISOString(),
        run.completedAt.toISOString(),
        JSON.stringify(run),
      );
  }

  async getRun(id: string): Promise<RunResult | null> {
    const row = this.db
      .prepare('SELECT data FROM runs WHERE id = ?')
      .get(id) as { data: string } | undefined;
    return row ? deserialise(row.data) : null;
  }

  async getMostRecentRun(suiteId?: string): Promise<RunResult | null> {
    const row = suiteId
      ? (this.db
          .prepare(
            'SELECT data FROM runs WHERE suite_id = ? ORDER BY started_at DESC LIMIT 1',
          )
          .get(suiteId) as { data: string } | undefined)
      : (this.db
          .prepare('SELECT data FROM runs ORDER BY started_at DESC LIMIT 1')
          .get() as { data: string } | undefined);
    return row ? deserialise(row.data) : null;
  }

  async listRuns(filter?: RunFilter): Promise<RunResult[]> {
    const suiteId = filter?.suiteId;
    const limit = filter?.limit;
    let sql = 'SELECT data FROM runs';
    const params: unknown[] = [];
    if (suiteId) {
      sql += ' WHERE suite_id = ?';
      params.push(suiteId);
    }
    sql += ' ORDER BY started_at DESC';
    if (typeof limit === 'number') {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    const rows = this.db.prepare(sql).all(...params) as Array<{ data: string }>;
    return rows.map((r) => deserialise(r.data));
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function runMigrations(db: BetterSqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_suite ON runs(suite_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
  `);
  const row = db
    .prepare('SELECT MAX(version) as v FROM schema_migrations')
    .get() as { v: number | null } | undefined;
  const current = row?.v ?? 0;
  if (current < SQLITE_SCHEMA_VERSION) {
    db.prepare(
      'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
    ).run(SQLITE_SCHEMA_VERSION, new Date().toISOString());
  }
}

function deserialise(data: string): RunResult {
  const raw = JSON.parse(data) as Omit<
    RunResult,
    'startedAt' | 'completedAt'
  > & {
    startedAt: string;
    completedAt: string;
  };
  return {
    ...raw,
    startedAt: new Date(raw.startedAt),
    completedAt: new Date(raw.completedAt),
  };
}

// Re-export the row type so tests can type-check raw queries if needed.
export type { SerialisedRunRow };
