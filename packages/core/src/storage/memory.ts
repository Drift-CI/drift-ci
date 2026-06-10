import type { RunResult } from '../types/index.js';
import type { RunFilter, StorageAdapter } from './interface.js';

export class MemoryStorage implements StorageAdapter {
  private runs = new Map<string, RunResult>();

  async saveRun(run: RunResult): Promise<void> {
    this.runs.set(run.id, run);
  }

  async getRun(id: string): Promise<RunResult | null> {
    return this.runs.get(id) ?? null;
  }

  async getMostRecentRun(suiteId?: string): Promise<RunResult | null> {
    const all = [...this.runs.values()]
      .filter((r) => (suiteId ? r.suiteId === suiteId : true))
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    return all[0] ?? null;
  }

  async listRuns(filter?: RunFilter): Promise<RunResult[]> {
    let all = [...this.runs.values()];
    if (filter?.suiteId) {
      all = all.filter((r) => r.suiteId === filter.suiteId);
    }
    all.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    if (filter?.limit !== undefined) {
      all = all.slice(0, filter.limit);
    }
    return all;
  }

  async close(): Promise<void> {
    this.runs.clear();
  }
}
