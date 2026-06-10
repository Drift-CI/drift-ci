import type {
  CaseResult,
  ConfigLoadResult,
  DeltaReport,
  RunResult,
  Suite,
} from '@drift-ci/core';

export interface RunStartContext {
  suite: Suite;
  provider: string;
}

export interface RunEndContext {
  suite: Suite;
  run: RunResult;
  deltas: DeltaReport | null;
  loaded: ConfigLoadResult;
}

export interface Reporter {
  onRunStart(ctx: RunStartContext): void | Promise<void>;
  onCaseComplete(result: CaseResult): void | Promise<void>;
  onRunEnd(ctx: RunEndContext): void | Promise<void>;
}

export type ReporterKind = 'terminal' | 'json';
