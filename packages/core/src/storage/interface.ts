import type { RunResult } from '../types/index.js';

export interface RunFilter {
  suiteId?: string;
  limit?: number;
}

export interface StorageAdapter {
  saveRun(run: RunResult): Promise<void>;
  getRun(id: string): Promise<RunResult | null>;
  getMostRecentRun(suiteId?: string): Promise<RunResult | null>;
  listRuns(filter?: RunFilter): Promise<RunResult[]>;
  close(): Promise<void>;
}
