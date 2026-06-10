import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { RunResult } from '../types/index.js';
import type { RunFilter, StorageAdapter } from './interface.js';

interface SerialisedRun extends Omit<RunResult, 'startedAt' | 'completedAt'> {
  startedAt: string;
  completedAt: string;
}

export class JsonFileStorage implements StorageAdapter {
  constructor(private root = '.drift/runs') {}

  private pathFor(id: string): string {
    return join(this.root, `${id}.json`);
  }

  async saveRun(run: RunResult): Promise<void> {
    const p = this.pathFor(run.id);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(serialise(run), null, 2) + '\n');
  }

  async getRun(id: string): Promise<RunResult | null> {
    const p = this.pathFor(id);
    if (!existsSync(p)) return null;
    return deserialise(JSON.parse(readFileSync(p, 'utf8')) as SerialisedRun);
  }

  async getMostRecentRun(suiteId?: string): Promise<RunResult | null> {
    const runs = await this.listRuns({ suiteId, limit: 1 });
    return runs[0] ?? null;
  }

  async listRuns(filter?: RunFilter): Promise<RunResult[]> {
    if (!existsSync(this.root)) return [];
    const all: RunResult[] = [];
    for (const name of readdirSync(this.root)) {
      if (!name.endsWith('.json')) continue;
      const raw = readFileSync(join(this.root, name), 'utf8');
      const run = deserialise(JSON.parse(raw) as SerialisedRun);
      if (filter?.suiteId && run.suiteId !== filter.suiteId) continue;
      all.push(run);
    }
    all.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    if (filter?.limit !== undefined) {
      return all.slice(0, filter.limit);
    }
    return all;
  }

  async close(): Promise<void> {
    // no-op
  }
}

function serialise(run: RunResult): SerialisedRun {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt.toISOString(),
  };
}

function deserialise(raw: SerialisedRun): RunResult {
  return {
    ...raw,
    startedAt: new Date(raw.startedAt),
    completedAt: new Date(raw.completedAt),
  };
}
