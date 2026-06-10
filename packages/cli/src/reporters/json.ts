import type { CaseResult } from '@drift-ci/core';
import { formatVersion } from '@drift-ci/core';

import type {
  Reporter,
  RunEndContext,
  RunStartContext,
} from './interface.js';

export const JSON_REPORTER_SCHEMA_VERSION = 1;

export interface JsonReporterOptions {
  out?: NodeJS.WritableStream;
}

export class JsonReporter implements Reporter {
  private readonly out: NodeJS.WritableStream;

  constructor(opts: JsonReporterOptions = {}) {
    this.out = opts.out ?? process.stdout;
  }

  onRunStart(_ctx: RunStartContext): void {}

  onCaseComplete(_result: CaseResult): void {}

  onRunEnd(ctx: RunEndContext): void {
    this.out.write(JSON.stringify(buildPayload(ctx), null, 2) + '\n');
  }
}

export interface JsonReporterPayload {
  schemaVersion: number;
  suite: { id: string; name: string };
  run: {
    id: string;
    suiteId: string;
    provider: string;
    startedAt: string;
    completedAt: string;
    cases: unknown[];
    summary: unknown;
  };
  deltas: unknown | null;
  config: {
    upgradedInMemory: boolean;
    requestedVersion: string;
  };
}

export function buildPayload(ctx: RunEndContext): JsonReporterPayload {
  return {
    schemaVersion: JSON_REPORTER_SCHEMA_VERSION,
    suite: { id: ctx.suite.id, name: ctx.suite.name },
    run: {
      id: ctx.run.id,
      suiteId: ctx.run.suiteId,
      provider: ctx.run.provider,
      startedAt: ctx.run.startedAt.toISOString(),
      completedAt: ctx.run.completedAt.toISOString(),
      cases: ctx.run.cases.map((c) => ({
        ...c,
        score: Number.isNaN(c.score) ? null : c.score,
      })),
      summary: ctx.run.summary,
    },
    deltas: ctx.deltas,
    config: {
      upgradedInMemory: ctx.loaded.upgradedInMemory,
      requestedVersion: formatVersion(ctx.loaded.requestedVersion),
    },
  };
}
