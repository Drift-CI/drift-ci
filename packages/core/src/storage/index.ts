export * from './interface.js';
export * from './memory.js';
export * from './json-file.js';
export * from './sqlite.js';
export * from './postgres.js';
export * from './http.js';

import { HttpStorage, type IngestContext } from './http.js';
import { JsonFileStorage } from './json-file.js';
import { MemoryStorage } from './memory.js';
import { PostgresStorage } from './postgres.js';
import { SQLiteStorage } from './sqlite.js';
import type { StorageAdapter } from './interface.js';
import type { DriftConfig } from '../types/config.js';

export interface CreateStorageOptions {
  runsDir?: string;
  sqlitePath?: string;
  /**
   * Precomputed ingest context for the `http` storage type. Callers pass
   * this after loading the suite so HttpStorage can enrich POST /api/v1/runs
   * payloads with per-case suiteHash + optional judgeHash.
   */
  httpContext?: IngestContext;
  /** Custom fetch for the http storage (tests). */
  httpFetch?: typeof fetch;
}

export async function createStorage(
  config: DriftConfig,
  opts: CreateStorageOptions = {},
): Promise<StorageAdapter> {
  const type = config.storage?.type ?? 'json-file';
  switch (type) {
    case 'memory':
      return new MemoryStorage();
    case 'json-file':
      return new JsonFileStorage(opts.runsDir ?? '.drift/runs');
    case 'sqlite': {
      const path = config.storage?.url ?? opts.sqlitePath ?? '.drift/db.sqlite';
      return SQLiteStorage.open(path);
    }
    case 'postgres': {
      if (!config.storage?.url) {
        throw new Error(
          "drift-ci: 'postgres' storage requires storage.url (e.g. postgres://user:pass@host:5432/drift_ci).",
        );
      }
      return PostgresStorage.open({ url: config.storage.url });
    }
    case 'http': {
      if (!config.storage?.url) {
        throw new Error(
          "drift-ci: 'http' storage requires storage.url (e.g. https://dashboard.example.com).",
        );
      }
      return new HttpStorage({
        url: config.storage.url,
        token: config.storage.token ?? process.env.DRIFT_INGEST_TOKEN,
        context: opts.httpContext,
        fetch: opts.httpFetch,
      });
    }
    default:
      throw new Error(`drift-ci: unknown storage type '${type as string}'.`);
  }
}
